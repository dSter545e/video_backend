const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutBucketCorsCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");
const { Transform } = require("stream");

const getR2Config = () => {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL || "";

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 config missing. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME");
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl,
  };
};

const createR2Client = () => {
  const { accountId, accessKeyId, secretAccessKey } = getR2Config();
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
};

const sendWithTimeout = async (client, command, timeoutMs) => {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    return await client.send(command, { abortSignal: abortController.signal });
  } finally {
    clearTimeout(timer);
  }
};

const getPublicFileUrl = ({ bucket, objectKey, publicBaseUrl }) => {
  const normalizedKey = String(objectKey || "").replace(/^\/+/, "");
  const fallbackR2Dev = `https://${bucket}.r2.dev/${normalizedKey}`;

  if (!publicBaseUrl) {
    return fallbackR2Dev;
  }

  const cleanedBase = publicBaseUrl.replace(/\/$/, "");
  if (cleanedBase.includes(".r2.cloudflarestorage.com")) {
    console.warn(
      "[R2] R2_PUBLIC_BASE_URL uses private cloudflarestorage endpoint. Using public r2.dev URL instead."
    );
    return fallbackR2Dev;
  }

  return `${cleanedBase}/${normalizedKey}`;
};

const uploadFileToR2 = async ({ localFilePath, objectKey, contentType, onProgress, preferBufferUpload = false }) => {
  const client = createR2Client();
  const { bucket, publicBaseUrl } = getR2Config();
  const totalBytes = fs.statSync(localFilePath).size;
  const startedAt = Date.now();
  let uploadedBytes = 0;
  let lastNotifiedBytes = 0;

  const source = fs.createReadStream(localFilePath);
  const progressStream = new Transform({
    transform(chunk, _encoding, callback) {
      uploadedBytes += chunk.length;
      const shouldNotify =
        uploadedBytes === totalBytes || uploadedBytes - lastNotifiedBytes >= 2 * 1024 * 1024;
      if (shouldNotify) {
        lastNotifiedBytes = uploadedBytes;
        const elapsedSec = Math.max(1, (Date.now() - startedAt) / 1000);
        const speedBytesPerSec = uploadedBytes / elapsedSec;
        const remainingBytes = Math.max(0, totalBytes - uploadedBytes);
        const etaSec = speedBytesPerSec > 0 ? Math.ceil(remainingBytes / speedBytesPerSec) : null;
        onProgress?.({
          uploadedBytes,
          totalBytes,
          uploadedMB: Number((uploadedBytes / (1024 * 1024)).toFixed(2)),
          totalMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
          percent: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0,
          elapsedSec: Number(elapsedSec.toFixed(1)),
          speedMBps: Number((speedBytesPerSec / (1024 * 1024)).toFixed(2)),
          etaSec,
        });
      }
      callback(null, chunk);
    },
  });

  const body = source.pipe(progressStream);

  if (preferBufferUpload) {
    onProgress?.({
      uploadedBytes: totalBytes,
      totalBytes,
      uploadedMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
      totalMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
      percent: 100,
      elapsedSec: 0,
      speedMBps: 0,
      etaSec: 0,
    });
    const buffer = fs.readFileSync(localFilePath);
    await sendWithTimeout(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: contentType,
        ContentLength: totalBytes,
      }),
      90000
    );
  } else {
    const streamCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
      ContentLength: totalBytes,
    });

    try {
      await sendWithTimeout(client, streamCommand, 45000);
    } catch (error) {
      const isAbort = error?.name === "AbortError";
      if (!isAbort) {
        throw error;
      }

      // Fallback for R2 ACK hang after 100% streamed upload.
      if (totalBytes > 200 * 1024 * 1024) {
        throw new Error("R2 upload timed out waiting for acknowledgement");
      }

      console.warn("[R2] Stream upload ACK timeout, retrying with buffered upload", { objectKey });
      const buffer = fs.readFileSync(localFilePath);
      await sendWithTimeout(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: buffer,
          ContentType: contentType,
          ContentLength: totalBytes,
        }),
        90000
      );
      console.warn("[R2] Buffered retry succeeded", { objectKey });
    }
  }

  const url = getPublicFileUrl({ bucket, objectKey, publicBaseUrl });

  return { url, key: objectKey };
};

const deleteFileFromR2 = async (objectKey) => {
  if (!objectKey) return;
  const client = createR2Client();
  const { bucket } = getR2Config();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    })
  );
};

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const downloadFileFromR2 = async (objectKey) => {
  if (!objectKey) throw new Error("objectKey is required");
  const client = createR2Client();
  const { bucket } = getR2Config();
  const result = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    })
  );
  return streamToBuffer(result.Body);
};

const listFilesFromR2 = async (prefix = "") => {
  const client = createR2Client();
  const { bucket } = getR2Config();
  const items = [];
  let continuationToken = undefined;
  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        ContinuationToken: continuationToken,
      })
    );
    for (const content of result.Contents || []) {
      items.push({
        key: content.Key,
        size: Number(content.Size || 0),
        lastModified: content.LastModified ? new Date(content.LastModified) : null,
      });
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  return items;
};

const extractObjectKeyFromUrl = (fileUrl) => {
  if (!fileUrl) return "";
  try {
    const parsed = new URL(fileUrl);
    return parsed.pathname.replace(/^\/+/, "");
  } catch (_error) {
    return "";
  }
};

const { parseOriginsFromEnv } = require("../config/cors");

const getDefaultCorsOrigins = () => parseOriginsFromEnv();

const configureR2Cors = async (allowedOrigins = getDefaultCorsOrigins()) => {
  const client = createR2Client();
  const { bucket } = getR2Config();
  const origins = Array.from(new Set(allowedOrigins.filter(Boolean)));

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins,
            AllowedMethods: ["GET", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag", "Content-Length", "Content-Type"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    })
  );

  return { bucket, origins };
};

module.exports = {
  uploadFileToR2,
  deleteFileFromR2,
  downloadFileFromR2,
  listFilesFromR2,
  extractObjectKeyFromUrl,
  configureR2Cors,
  getDefaultCorsOrigins,
  createR2Client,
  getR2Config,
};

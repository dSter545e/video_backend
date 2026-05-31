const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutBucketCorsCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");
const { Transform } = require("stream");

const normalizeServerConfig = (serverConfig) => ({
  accountId: serverConfig.accountId,
  accessKeyId: serverConfig.accessKeyId,
  secretAccessKey: serverConfig.secretAccessKey,
  bucket: serverConfig.bucketName || serverConfig.bucket,
  publicBaseUrl: serverConfig.publicBaseUrl || "",
});

const formatR2Error = (error) => {
  const name = error?.name || "";
  const message = String(error?.message || "Unknown storage error");
  const httpStatus = error?.$metadata?.httpStatusCode;

  if (name === "NoSuchBucket" || httpStatus === 404) {
    return "Bucket not found. Verify the bucket name and Cloudflare Account ID.";
  }
  if (name === "InvalidAccessKeyId") {
    return "Invalid Access Key ID.";
  }
  if (name === "SignatureDoesNotMatch") {
    return "Invalid Secret Access Key.";
  }
  if (httpStatus === 403 || name === "AccessDenied") {
    return "Access denied. Check API token permissions and that the bucket belongs to this account.";
  }
  if (message.includes("UnknownError") || name === "Unknown") {
    return "Could not connect to R2. Verify Account ID, access keys, bucket name, and that the bucket exists.";
  }
  return message;
};

const resolveDefaultStorageServer = async () => {
  const StorageServer = require("../models/StorageServer");
  const defaultServer = await StorageServer.findOne({ isDefault: true, isActive: true });
  if (defaultServer) return defaultServer;
  return StorageServer.findOne({ isActive: true }).sort({ createdAt: 1 });
};

const getR2Config = async (serverConfig = null) => {
  if (serverConfig) {
    return normalizeServerConfig(serverConfig);
  }

  const server = await resolveDefaultStorageServer();
  if (!server) {
    throw new Error("No active storage server configured. Add one in Admin → Storage.");
  }

  return normalizeServerConfig(server.toObject());
};

const getDefaultStorageServer = async () => resolveDefaultStorageServer();

const createR2Client = async (serverConfig = null) => {
  const { accountId, accessKeyId, secretAccessKey } = await getR2Config(serverConfig);
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
    return fallbackR2Dev;
  }

  return `${cleanedBase}/${normalizedKey}`;
};

const uploadFileToR2 = async ({ localFilePath, objectKey, contentType, onProgress, preferBufferUpload = false, serverConfig = null }) => {
  const client = await createR2Client(serverConfig);
  const { bucket, publicBaseUrl } = await getR2Config(serverConfig);
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

const deleteFileFromR2 = async (objectKey, serverConfig = null) => {
  if (!objectKey) return;
  const client = await createR2Client(serverConfig);
  const { bucket } = await getR2Config(serverConfig);
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

const downloadFileFromR2 = async (objectKey, serverConfig = null) => {
  if (!objectKey) throw new Error("objectKey is required");
  const client = await createR2Client(serverConfig);
  const { bucket } = await getR2Config(serverConfig);
  const result = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    })
  );
  return streamToBuffer(result.Body);
};

const listFilesFromR2 = async (prefix = "", serverConfig = null) => {
  const client = await createR2Client(serverConfig);
  const { bucket } = await getR2Config(serverConfig);
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

const configureR2Cors = async (allowedOrigins = getDefaultCorsOrigins(), serverConfig = null) => {
  const client = await createR2Client(serverConfig);
  const { bucket } = await getR2Config(serverConfig);
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

const configureAllR2Cors = async (allowedOrigins = getDefaultCorsOrigins()) => {
  const StorageServer = require("../models/StorageServer");
  const servers = await StorageServer.find({ isActive: true }).sort({ isDefault: -1, name: 1 });
  if (!servers.length) {
    throw new Error("No active storage servers configured. Add one in Admin → Storage.");
  }

  const results = [];
  for (const server of servers) {
    const config = server.toObject();
    const result = await configureR2Cors(allowedOrigins, config);
    results.push({ serverId: server._id, name: server.name, ...result });
  }
  return results;
};

const headBucketInR2 = async (serverConfig = null) => {
  const { HeadBucketCommand } = require("@aws-sdk/client-s3");
  try {
    const client = await createR2Client(serverConfig);
    const { bucket } = await getR2Config(serverConfig);
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return { bucket };
  } catch (error) {
    throw new Error(formatR2Error(error));
  }
};

const headObjectInR2 = async (objectKey, serverConfig = null) => {
  if (!objectKey) throw new Error("objectKey is required");
  const { HeadObjectCommand } = require("@aws-sdk/client-s3");
  try {
    const client = await createR2Client(serverConfig);
    const { bucket } = await getR2Config(serverConfig);
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    return { bucket, key: objectKey };
  } catch (error) {
    throw new Error(formatR2Error(error));
  }
};

module.exports = {
  uploadFileToR2,
  deleteFileFromR2,
  downloadFileFromR2,
  listFilesFromR2,
  extractObjectKeyFromUrl,
  configureR2Cors,
  configureAllR2Cors,
  getDefaultCorsOrigins,
  createR2Client,
  getR2Config,
  getDefaultStorageServer,
  headBucketInR2,
  headObjectInR2,
  formatR2Error,
};

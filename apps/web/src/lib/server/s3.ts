import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "$env/dynamic/private";

let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: env.S3_REGION ?? "us-east-1",
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID ?? "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY ?? "",
      },
      // S3_ENDPOINT: set for local dev (Supabase Storage S3-compatible API)
      // Remove for production AWS S3
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    });
  }
  return _s3;
}

function getBucket(): string {
  return env.S3_BUCKET ?? "";
}

export async function createMultipartUpload(
  key: string,
  contentType: string,
): Promise<string> {
  const { UploadId } = await getS3().send(
    new CreateMultipartUploadCommand({
      Bucket: getBucket(),
      Key: key,
      ContentType: contentType,
    }),
  );
  if (!UploadId) throw new Error("Failed to create multipart upload");
  return UploadId;
}

export async function getUploadPartUrl(
  key: string,
  uploadId: string,
  partNumber: number,
): Promise<string> {
  return getSignedUrl(
    getS3(),
    new UploadPartCommand({
      Bucket: getBucket(),
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn: 3600 },
  );
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: CompletedPart[],
): Promise<void> {
  await getS3().send(
    new CompleteMultipartUploadCommand({
      Bucket: getBucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }),
  );
}

export async function getPresignedDownloadUrl(key: string): Promise<string> {
  return getSignedUrl(
    getS3(),
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }),
    { expiresIn: 3600 },
  );
}

export async function deleteS3Prefix(prefix: string): Promise<void> {
  const bucket = getBucket();
  const { Contents } = await getS3().send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );
  if (Contents?.length) {
    await Promise.all(
      Contents.map((obj) =>
        getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key })),
      ),
    );
  }
}

export async function deleteS3Object(key: string): Promise<void> {
  await getS3().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  );
}

export async function getObject<T = unknown>(key: string): Promise<T> {
  const { Body } = await getS3().send(
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }),
  );
  if (!Body) throw new Error(`No body returned for key: ${key}`);
  const text = await Body.transformToString("utf-8");
  return JSON.parse(text) as T;
}

import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  GetObjectCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.S3_BUCKET!;

export async function createMultipartUpload(
  key: string,
  contentType: string,
): Promise<string> {
  const { UploadId } = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: BUCKET,
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
    s3,
    new UploadPartCommand({
      Bucket: BUCKET,
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
  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }),
  );
}

export async function getPresignedDownloadUrl(key: string): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
    { expiresIn: 3600 },
  );
}

export async function getObject<T = unknown>(key: string): Promise<T> {
  const { Body } = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );
  if (!Body) throw new Error(`No body returned for key: ${key}`);
  const text = await Body.transformToString("utf-8");
  return JSON.parse(text) as T;
}

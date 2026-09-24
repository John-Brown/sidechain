# Local → AWS Migration Checklist

Changes made for local dev that need reverting/updating for production AWS deployment.

## S3 Storage

### `apps/web/src/lib/server/s3.ts`
- **Local**: Uses `S3_ENDPOINT` env var to point at Supabase local S3-compatible storage (`http://127.0.0.1:54321/storage/v1/s3`) with `forcePathStyle: true`
- **AWS**: Remove `S3_ENDPOINT` from `.env`. The S3 client auto-connects to AWS when no endpoint override is set. `forcePathStyle` is only needed for S3-compatible APIs, not real AWS S3.

### `.env` S3 vars
- **Local**: `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (Supabase storage keys)
- **AWS**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (or use IAM roles), `S3_BUCKET`, `S3_REGION`. Remove `S3_ENDPOINT`.

### Bucket setup
- **Local**: Bucket `annotation-uploads` created via Supabase Storage API
- **AWS**: Create S3 bucket with appropriate CORS policy for presigned URL uploads from browser

## Environment Variables (`.env`)

| Var | Local | AWS |
|-----|-------|-----|
| `S3_ENDPOINT` | `http://127.0.0.1:54321/storage/v1/s3` | _(remove)_ |
| `S3_ACCESS_KEY_ID` | Supabase storage key | _(use AWS_ACCESS_KEY_ID)_ |
| `S3_SECRET_ACCESS_KEY` | Supabase storage secret | _(use AWS_SECRET_ACCESS_KEY)_ |
| `S3_BUCKET` | `annotation-uploads` | Your AWS bucket name |
| `S3_REGION` | `us-east-1` | Your AWS region |
| `PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` | `https://YOUR_PROJECT.supabase.co` |
| `DATABASE_URL` | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | Supabase pooler URL |
| `MODAL_BASE_URL` | _(empty for local)_ | `https://your-workspace--annotation-pipeline` (no `.modal.run`; the trigger appends `-<function>.modal.run`) |
| `PUBLIC_APP_URL` | `http://localhost:5173` | Your deployed app URL |

## Modal Pipeline
- **Local**: `MODAL_BASE_URL` left empty — pipeline trigger will fail gracefully
- **AWS/Production**: Set `MODAL_BASE_URL` after `modal deploy`, ensure `PUBLIC_APP_URL` is reachable for callbacks

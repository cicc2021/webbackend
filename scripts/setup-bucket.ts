/**
 * Lets anyone read files under media/ so the website can show them. Nothing else in the bucket
 * becomes public, and writing still needs the access key. Safe to re-run.
 *
 *   npm run bucket:setup
 */
import { PutBucketPolicyCommand, S3Client } from '@aws-sdk/client-s3';
import { config as loadEnv } from 'dotenv';
import { storageFromEnv } from '../src/config/configuration';

for (const f of ['.env.local', `.env.${process.env.NODE_ENV ?? 'development'}`, '.env']) loadEnv({ path: f, quiet: true });

async function main() {
  const cfg = storageFromEnv();
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
  const Policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${cfg.bucket}/media/*`] }],
  });
  await client.send(new PutBucketPolicyCommand({ Bucket: cfg.bucket, Policy }));
  console.log(`Public read enabled for ${cfg.bucket}/media/*`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

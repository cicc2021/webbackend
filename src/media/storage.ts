import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { StorageConfig } from '../config/configuration';

export const LOCAL_UPLOAD_DIR = join(process.cwd(), 'uploads');

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  remove(key: string): Promise<void>;
}

class LocalStorage implements Storage {
  constructor(private readonly origin: string) {}

  async put(key: string, body: Buffer) {
    const file = join(LOCAL_UPLOAD_DIR, key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
    return `${this.origin}/uploads/${key}`;
  }

  async remove(key: string) {
    await unlink(join(LOCAL_UPLOAD_DIR, key)).catch(() => undefined);
  }
}

/** Utho Object Storage speaks the S3 API. */
class S3Storage implements Storage {
  private readonly client: S3Client;

  constructor(private readonly cfg: StorageConfig) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: 'public-read',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return `${this.cfg.publicUrl}/${key}`;
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}

export function createStorage(cfg: StorageConfig, localOrigin: string): Storage {
  return cfg.driver === 's3' ? new S3Storage(cfg) : new LocalStorage(localOrigin);
}

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.subarray(0, 3).toString('latin1') === 'GIF' },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'image/avif', ext: 'avif', test: (b) => b.subarray(4, 12).toString('latin1') === 'ftypavif' },
];

/** Decides the type from the bytes, not the client's claim. SVG is excluded because it can carry script. */
export function detectImage(buf: Buffer) {
  return SIGNATURES.find((s) => s.test(buf)) ?? null;
}

/** For the site importer, which also moves documents. Admin uploads stay image-only. */
export function detectDocumentOrImage(buf: Buffer) {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return detectImage(buf);
}

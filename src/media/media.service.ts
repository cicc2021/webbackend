import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AppConfig, StorageConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { createStorage, detectImage, Storage } from './storage';

@Injectable()
export class MediaService {
  private readonly storage: Storage;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.storage = createStorage(
      config.getOrThrow<StorageConfig>('storage'),
      config.getOrThrow<AppConfig>('app').publicApiOrigin,
    );
  }

  list(search?: string) {
    return this.prisma.media.findMany({
      where: search ? { filename: { contains: search, mode: 'insensitive' } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  async upload(file: Express.Multer.File | undefined, alt = '') {
    if (!file) throw new BadRequestException('No file uploaded');
    const kind = detectImage(file.buffer);
    if (!kind) throw new BadRequestException('Only JPEG, PNG, GIF, WebP and AVIF images are allowed');
    const now = new Date();
    const key = `media/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${kind.ext}`;
    const url = await this.storage.put(key, file.buffer, kind.mime);
    return this.prisma.media.create({
      data: { key, url, filename: file.originalname.slice(0, 200), mimeType: kind.mime, size: file.size, alt },
    });
  }

  updateAlt(id: string, alt: string) {
    return this.prisma.media.update({ where: { id }, data: { alt } });
  }

  async remove(id: string) {
    const media = await this.prisma.media.delete({ where: { id } });
    await this.storage.remove(media.key);
  }
}

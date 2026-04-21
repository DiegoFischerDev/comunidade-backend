import { Injectable, Logger } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';

const HOUSE_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/3gpp',
]);

@Injectable()
export class HouseImageStorageService {
  private readonly logger = new Logger(HouseImageStorageService.name);

  private async readBuffer(file: Express.Multer.File): Promise<Buffer | null> {
    if (file.buffer?.length) return file.buffer;
    if (file.path) {
      try {
        return await readFile(file.path);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Converte para WebP, grava em R2 ou disco, devolve URL pública e base64 para envio WhatsApp.
   */
  async processHouseImageForListing(file: Express.Multer.File): Promise<{
    publicUrl: string;
    waBase64: string;
    waMimeType: string;
  }> {
    const buf = await this.readBuffer(file);
    if (!buf?.length) {
      throw new Error('Imagem inválida (sem conteúdo).');
    }
    let webp: Buffer;
    try {
      webp = await sharp(buf)
        .rotate()
        .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch (e) {
      this.logger.warn(`sharp falhou ao processar imagem: ${e}`);
      throw new Error('Não foi possível processar esta imagem.');
    }
    const publicUrl = await this.uploadWebp(webp);
    return {
      publicUrl,
      waBase64: webp.toString('base64'),
      waMimeType: 'image/webp',
    };
  }

  private async uploadWebp(webp: Buffer): Promise<string> {
    const key = `houses/${Date.now()}-${randomBytes(8).toString('hex')}.webp`;
    const r2Endpoint = process.env.R2_ENDPOINT?.trim();
    const r2Bucket = process.env.R2_BUCKET?.trim();
    const r2Access = process.env.R2_ACCESS_KEY_ID?.trim();
    const r2Secret = process.env.R2_SECRET_ACCESS_KEY?.trim();
    const r2Public = process.env.R2_PUBLIC_BASE_URL?.trim()?.replace(/\/$/, '');

    if (r2Endpoint && r2Bucket && r2Access && r2Secret && r2Public) {
      const client = new S3Client({
        region: 'auto',
        endpoint: r2Endpoint,
        credentials: { accessKeyId: r2Access, secretAccessKey: r2Secret },
        forcePathStyle: true,
      });
      await client.send(
        new PutObjectCommand({
          Bucket: r2Bucket,
          Key: key,
          Body: webp,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${r2Public}/${key}`;
    }

    const dir = join(process.cwd(), 'uploads', 'houses');
    await mkdir(dir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(8).toString('hex')}.webp`;
    await writeFile(join(dir, name), webp);
    const base =
      process.env.PUBLIC_API_BASE_URL?.replace(/\/$/, '') ||
      `http://localhost:${process.env.PORT ?? 3001}`;
    return `${base}/uploads/houses/${name}`;
  }

  /** Vídeo original (sem transcodificação), para listagem e envio WhatsApp. */
  async storeHouseVideo(file: Express.Multer.File): Promise<{
    publicUrl: string;
    waBase64: string;
    waMimeType: string;
    waFileName: string;
  }> {
    const buf = await this.readBuffer(file);
    if (!buf?.length) {
      throw new Error('Vídeo inválido (sem conteúdo).');
    }
    const mime = (file.mimetype || '').split(';')[0]!.trim().toLowerCase();
    if (!HOUSE_VIDEO_MIMES.has(mime)) {
      throw new Error(
        'Formato de vídeo não suportado. Usa MP4, MOV, WebM ou 3GP.',
      );
    }
    const ext =
      mime === 'video/quicktime'
        ? '.mov'
        : mime === 'video/webm'
          ? '.webm'
          : mime === 'video/3gpp'
            ? '.3gp'
            : '.mp4';
    const publicUrl = await this.uploadBinary(buf, mime, 'houses/videos', ext);
    const baseName = (file.originalname || 'video').replace(/\.[^.]+$/, '');
    return {
      publicUrl,
      waBase64: buf.toString('base64'),
      waMimeType: mime,
      waFileName: `${baseName}${ext}`,
    };
  }

  private async uploadBinary(
    body: Buffer,
    contentType: string,
    keyPrefix: string,
    extension: string,
  ): Promise<string> {
    const key = `${keyPrefix}/${Date.now()}-${randomBytes(8).toString('hex')}${extension}`;
    const r2Endpoint = process.env.R2_ENDPOINT?.trim();
    const r2Bucket = process.env.R2_BUCKET?.trim();
    const r2Access = process.env.R2_ACCESS_KEY_ID?.trim();
    const r2Secret = process.env.R2_SECRET_ACCESS_KEY?.trim();
    const r2Public = process.env.R2_PUBLIC_BASE_URL?.trim()?.replace(/\/$/, '');

    if (r2Endpoint && r2Bucket && r2Access && r2Secret && r2Public) {
      const client = new S3Client({
        region: 'auto',
        endpoint: r2Endpoint,
        credentials: { accessKeyId: r2Access, secretAccessKey: r2Secret },
        forcePathStyle: true,
      });
      await client.send(
        new PutObjectCommand({
          Bucket: r2Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${r2Public}/${key}`;
    }

    const relativeDir = keyPrefix.replace(/^houses\//, '');
    const dir = join(process.cwd(), 'uploads', 'houses', relativeDir);
    await mkdir(dir, { recursive: true });
    const fileName = `${Date.now()}-${randomBytes(8).toString('hex')}${extension}`;
    await writeFile(join(dir, fileName), body);
    const base =
      process.env.PUBLIC_API_BASE_URL?.replace(/\/$/, '') ||
      `http://localhost:${process.env.PORT ?? 3001}`;
    return `${base}/uploads/houses/${relativeDir}/${fileName}`;
  }
}

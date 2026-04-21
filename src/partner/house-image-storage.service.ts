import { Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import {
  extensionForHouseVideoMime,
  isHouseVideoTranscodeEnabled,
  transcodeVideoToWhatsappMp4,
} from './house-video-transcode';

const HOUSE_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/3gpp',
]);

@Injectable()
export class HouseImageStorageService {
  private readonly logger = new Logger(HouseImageStorageService.name);

  private getR2Context(): {
    client: S3Client;
    bucket: string;
    publicBase: string;
  } | null {
    const r2Endpoint = process.env.R2_ENDPOINT?.trim();
    const r2Bucket = process.env.R2_BUCKET?.trim();
    const r2Access = process.env.R2_ACCESS_KEY_ID?.trim();
    const r2Secret = process.env.R2_SECRET_ACCESS_KEY?.trim();
    const r2Public = process.env.R2_PUBLIC_BASE_URL?.trim()?.replace(/\/$/, '');
    if (!r2Endpoint || !r2Bucket || !r2Access || !r2Secret || !r2Public) {
      return null;
    }
    return {
      client: new S3Client({
        region: 'auto',
        endpoint: r2Endpoint,
        credentials: { accessKeyId: r2Access, secretAccessKey: r2Secret },
        forcePathStyle: true,
      }),
      bucket: r2Bucket,
      publicBase: r2Public,
    };
  }

  /**
   * Remove ficheiro local (`/uploads/...`) ou objeto em R2 quando a URL corresponde a `R2_PUBLIC_BASE_URL`.
   */
  async deleteStoredUrl(url: string | null | undefined): Promise<void> {
    if (!url?.trim()) return;
    const raw = url.trim();

    let pathname = raw;
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      try {
        pathname = new URL(raw).pathname;
      } catch {
        this.logger.warn(`deleteStoredUrl: URL inválida (${raw.slice(0, 64)}…)`);
        return;
      }
    }

    if (pathname.startsWith('/uploads/')) {
      const rel = pathname.replace(/^\/uploads\//, '');
      if (!rel) return;
      const filePath = join(process.cwd(), 'uploads', rel);
      try {
        await unlink(filePath);
      } catch (e: unknown) {
        const code =
          e && typeof e === 'object' && 'code' in e
            ? String((e as { code?: string }).code)
            : '';
        if (code !== 'ENOENT') {
          this.logger.warn(`deleteStoredUrl: ${filePath}: ${e}`);
        }
      }
      return;
    }

    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
      return;
    }

    const cfg = this.getR2Context();
    if (!cfg) {
      this.logger.warn(
        `deleteStoredUrl: R2 não configurado; ficheiro remoto pode ficar órfão: ${raw.slice(0, 80)}`,
      );
      return;
    }

    const pub = cfg.publicBase;
    let key: string | null = null;
    if (raw.startsWith(pub)) {
      key = raw.slice(pub.length).replace(/^\/+/, '');
    } else {
      try {
        const asset = new URL(raw);
        const base = new URL(pub);
        if (asset.origin === base.origin) {
          const basePath = base.pathname.replace(/\/$/, '') || '';
          let p = asset.pathname;
          if (basePath && p.startsWith(basePath)) {
            p = p.slice(basePath.length);
          }
          key = p.replace(/^\/+/, '');
        }
      } catch {
        key = null;
      }
    }

    if (!key) {
      this.logger.warn(`deleteStoredUrl: não foi possível obter a chave R2 de ${raw.slice(0, 80)}`);
      return;
    }

    try {
      await cfg.client.send(
        new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }),
      );
    } catch (e) {
      this.logger.warn(`deleteStoredUrl: DeleteObject ${key}: ${e}`);
    }
  }

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
    const r2 = this.getR2Context();
    if (r2) {
      await r2.client.send(
        new PutObjectCommand({
          Bucket: r2.bucket,
          Key: key,
          Body: webp,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${r2.publicBase}/${key}`;
    }

    const dir = join(process.cwd(), 'uploads', 'houses');
    await mkdir(dir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(8).toString('hex')}.webp`;
    await writeFile(join(dir, name), webp);
    // Caminho relativo: o browser usa NEXT_PUBLIC_API_URL + path (evita localhost na BD em stage/prod).
    return `/uploads/houses/${name}`;
  }

  /**
   * Grava vídeo para listagem pública e WhatsApp.
   * Ficheiros acima de ~400 KB são reencodados (ffmpeg) para MP4 H.264/AAC mais leve, quando possível.
   */
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
    const srcExt = extensionForHouseVideoMime(mime);
    let body = buf;
    let outMime = mime;
    let outExt = srcExt;
    const compressed = await transcodeVideoToWhatsappMp4(buf, srcExt);
    if (compressed?.length) {
      const beforeMb = buf.length / 1024 / 1024;
      const afterMb = compressed.length / 1024 / 1024;
      body = compressed;
      outMime = 'video/mp4';
      outExt = '.mp4';
      this.logger.log(
        `Vídeo otimizado para envio: ${beforeMb.toFixed(2)} MB → ${afterMb.toFixed(2)} MB`,
      );
    } else if (
      isHouseVideoTranscodeEnabled() &&
      buf.length > 512 * 1024
    ) {
      this.logger.warn(
        'ffmpeg não produziu versão mais leve (timeout ou erro). A usar ficheiro original.',
      );
    }
    const publicUrl = await this.uploadBinary(
      body,
      outMime,
      'houses/videos',
      outExt,
    );
    const baseName = (file.originalname || 'video').replace(/\.[^.]+$/, '');
    return {
      publicUrl,
      waBase64: body.toString('base64'),
      waMimeType: outMime,
      waFileName: `${baseName}${outExt}`,
    };
  }

  private async uploadBinary(
    body: Buffer,
    contentType: string,
    keyPrefix: string,
    extension: string,
  ): Promise<string> {
    const key = `${keyPrefix}/${Date.now()}-${randomBytes(8).toString('hex')}${extension}`;
    const r2 = this.getR2Context();
    if (r2) {
      await r2.client.send(
        new PutObjectCommand({
          Bucket: r2.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${r2.publicBase}/${key}`;
    }

    const relativeDir = keyPrefix.replace(/^houses\//, '');
    const dir = join(process.cwd(), 'uploads', 'houses', relativeDir);
    await mkdir(dir, { recursive: true });
    const fileName = `${Date.now()}-${randomBytes(8).toString('hex')}${extension}`;
    await writeFile(join(dir, fileName), body);
    return `/uploads/houses/${relativeDir}/${fileName}`;
  }
}

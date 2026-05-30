import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
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
   * Alguns browsers em mobile enviam `video/mp4` para ficheiros QuickTime (brand `qt  `)
   * ou `application/octet-stream` sem MIME fiável. Preferimos o container real (ftyp / WebM).
   * Brand QuickTime (`qt  `) grava-se como MP4: a Evolution costuma falhar com `video/quicktime` / `.mov`.
   */
  private sniffVideoKind(buf: Buffer): 'webm' | 'mov' | 'mp4' | '3gp' | null {
    if (buf.length >= 4) {
      if (
        buf[0] === 0x1a &&
        buf[1] === 0x45 &&
        buf[2] === 0xdf &&
        buf[3] === 0xa3
      ) {
        return 'webm';
      }
    }
    const limit = Math.min(buf.length, 128) - 8;
    for (let i = 0; i <= limit; i++) {
      if (buf.toString('ascii', i, i + 4) !== 'ftyp') continue;
      const brand = buf.toString('ascii', i + 4, i + 8);
      if (brand === 'qt  ' || brand === 'fqt ') {
        return 'mov';
      }
      if (/^3g/.test(brand) || brand === '3g2a' || brand === '3g2b') {
        return '3gp';
      }
      return 'mp4';
    }
    return null;
  }

  private inferMimeFromOriginalName(originalname: string): string | null {
    const base = (originalname || '').split(/[/\\]/).pop()?.toLowerCase() ?? '';
    if (!base.includes('.')) return null;
    const ext = base.slice(base.lastIndexOf('.'));
    const map: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.m4v': 'video/mp4',
      '.mov': 'video/quicktime',
      '.qt': 'video/quicktime',
      '.webm': 'video/webm',
      '.3gp': 'video/3gpp',
      '.3gpp': 'video/3gpp',
      '.3g2': 'video/3gpp',
    };
    return map[ext] ?? null;
  }

  private normalizeDeclaredVideoMime(mime: string): string | null {
    const m = mime.trim().toLowerCase().split(';')[0]!.trim();
    if (!m) return null;
    if (HOUSE_VIDEO_MIMES.has(m)) return m;
    if (m === 'video/x-m4v' || m === 'video/m4v') return 'video/mp4';
    if (m === 'video/3gp') return 'video/3gpp';
    return null;
  }

  private mimeAndExtFromCanonicalMime(mime: string): { mime: string; ext: string } {
    if (mime === 'video/quicktime') {
      return { mime: 'video/mp4', ext: '.mp4' };
    }
    if (mime === 'video/webm') return { mime, ext: '.webm' };
    if (mime === 'video/3gpp') return { mime, ext: '.3gp' };
    if (mime === 'video/mp4') return { mime, ext: '.mp4' };
    throw new Error('MIME de vídeo interno inválido.');
  }

  private resolveHouseVideoMimeAndExt(
    declaredMime: string,
    originalName: string,
    buf: Buffer,
  ): { mime: string; ext: string } {
    const sniffed = this.sniffVideoKind(buf);
    if (sniffed) {
      if (sniffed === 'webm') return { mime: 'video/webm', ext: '.webm' };
      if (sniffed === '3gp') return { mime: 'video/3gpp', ext: '.3gp' };
      if (sniffed === 'mov') return { mime: 'video/mp4', ext: '.mp4' };
      return { mime: 'video/mp4', ext: '.mp4' };
    }

    const rawMime = (declaredMime || '').split(';')[0]!.trim().toLowerCase();
    const normalized = this.normalizeDeclaredVideoMime(rawMime);
    if (normalized) {
      return this.mimeAndExtFromCanonicalMime(normalized);
    }

    if (
      rawMime === 'application/octet-stream' ||
      rawMime === '' ||
      rawMime === 'binary/octet-stream'
    ) {
      const fromName = this.inferMimeFromOriginalName(originalName || '');
      if (fromName) {
        const n = this.normalizeDeclaredVideoMime(fromName);
        if (n) return this.mimeAndExtFromCanonicalMime(n);
      }
    }

    throw new Error(
      'Formato de vídeo não suportado. Usa MP4, MOV, WebM ou 3GP.',
    );
  }

  /**
   * Converte para WebP, grava em R2 ou disco, devolve URL pública para a página do imóvel.
   */
  async processHouseImageForListing(file: Express.Multer.File): Promise<{
    publicUrl: string;
  }> {
    const buf = await this.readBuffer(file);
    if (!buf?.length) {
      throw new Error('Imagem inválida (sem conteúdo).');
    }
    return this.processHouseImageBuffer(buf);
  }

  /** Converte um buffer de imagem para WebP e grava (R2/disco). Para mídia capturada (scan). */
  async processHouseImageBuffer(buf: Buffer): Promise<{ publicUrl: string }> {
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
    return { publicUrl };
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

  private async uploadOgJpeg(jpeg: Buffer): Promise<string> {
    const key = `share-links/og/${Date.now()}-${randomBytes(8).toString('hex')}.jpg`;
    const r2 = this.getR2Context();
    if (r2) {
      await r2.client.send(
        new PutObjectCommand({
          Bucket: r2.bucket,
          Key: key,
          Body: jpeg,
          ContentType: 'image/jpeg',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${r2.publicBase}/${key}`;
    }

    const dir = join(process.cwd(), 'uploads', 'share-links', 'og');
    await mkdir(dir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(8).toString('hex')}.jpg`;
    await writeFile(join(dir, name), jpeg);
    return `/uploads/share-links/og/${name}`;
  }

  /**
   * Imagem OG para partilha do link (1200×630, JPEG). Grava em R2 ou `uploads/share-links/og/`.
   */
  /**
   * Imagem do card em /servicos (4:3, JPEG). Grava em R2 ou `uploads/recommended-services/cards/`.
   */
  async processRecommendedServiceCardImage(file: Express.Multer.File): Promise<{
    publicUrl: string;
  }> {
    const buf = await this.readBuffer(file);
    if (!buf?.length) {
      throw new Error('Imagem inválida (sem conteúdo).');
    }
    let jpeg: Buffer;
    try {
      jpeg = await sharp(buf)
        .rotate()
        .resize(960, 720, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
    } catch (e) {
      this.logger.warn(`sharp recommended service card: ${e}`);
      throw new Error('Não foi possível processar esta imagem.');
    }
    const publicUrl = await this.uploadRecommendedCardJpeg(jpeg);
    return { publicUrl };
  }

  private async uploadRecommendedCardJpeg(jpeg: Buffer): Promise<string> {
    const key = `recommended-services/cards/${Date.now()}-${randomBytes(8).toString('hex')}.jpg`;
    const r2 = this.getR2Context();
    if (r2) {
      await r2.client.send(
        new PutObjectCommand({
          Bucket: r2.bucket,
          Key: key,
          Body: jpeg,
          ContentType: 'image/jpeg',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${r2.publicBase}/${key}`;
    }

    const dir = join(process.cwd(), 'uploads', 'recommended-services', 'cards');
    await mkdir(dir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(8).toString('hex')}.jpg`;
    await writeFile(join(dir, name), jpeg);
    return `/uploads/recommended-services/cards/${name}`;
  }

  async processShareLinkOgImage(file: Express.Multer.File): Promise<{
    publicUrl: string;
  }> {
    const buf = await this.readBuffer(file);
    if (!buf?.length) {
      throw new Error('Imagem inválida (sem conteúdo).');
    }
    let jpeg: Buffer;
    try {
      jpeg = await sharp(buf)
        .rotate()
        .resize(1200, 630, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: 86, mozjpeg: true })
        .toBuffer();
    } catch (e) {
      this.logger.warn(`sharp OG share link: ${e}`);
      throw new Error('Não foi possível processar esta imagem.');
    }
    const publicUrl = await this.uploadOgJpeg(jpeg);
    return { publicUrl };
  }

  /** Grava vídeo original para a página pública do imóvel (não enviado ao WhatsApp). */
  async storeHouseVideo(file: Express.Multer.File): Promise<{ publicUrl: string }> {
    const buf = await this.readBuffer(file);
    if (!buf?.length) {
      throw new Error('Vídeo inválido (sem conteúdo).');
    }
    const { mime, ext } = this.resolveHouseVideoMimeAndExt(
      file.mimetype || '',
      file.originalname || '',
      buf,
    );
    const publicUrl = await this.uploadBinary(buf, mime, 'houses/videos', ext);
    return { publicUrl };
  }

  /** Grava um buffer de vídeo (mídia capturada no scan). */
  async storeHouseVideoBuffer(
    buf: Buffer,
    declaredMime: string,
    originalName = '',
  ): Promise<{ publicUrl: string }> {
    if (!buf?.length) {
      throw new Error('Vídeo inválido (sem conteúdo).');
    }
    const { mime, ext } = this.resolveHouseVideoMimeAndExt(
      declaredMime || '',
      originalName || '',
      buf,
    );
    const publicUrl = await this.uploadBinary(buf, mime, 'houses/videos', ext);
    return { publicUrl };
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

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { unlink } from 'fs/promises';
import { GrupoTesteMessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HouseImageStorageService } from '../partner/house-image-storage.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function publicApiBase(): string {
  return (process.env.PUBLIC_API_BASE_URL || 'http://localhost:3001').replace(
    /\/$/,
    '',
  );
}

/** Evolution precisa de URL http(s) acessível a partir do servidor da API. */
export function toAbsoluteMediaUrl(stored: string): string {
  const u = stored.trim();
  if (!u) return '';
  if (u.startsWith('https://') || u.startsWith('http://')) return u;
  const base = publicApiBase();
  return u.startsWith('/') ? `${base}${u}` : `${base}/${u}`;
}

function normalizeGroupJid(raw: string): string {
  const t = raw.trim();
  if (!t) {
    throw new BadRequestException('Indica o ID / JID do grupo WhatsApp.');
  }
  if (t.includes('@')) return t;
  throw new BadRequestException(
    'JID do grupo inválido. Usa o formato completo (ex.: 120363…@g.us).',
  );
}

function videoMimeFromUrl(url: string): { mime: string; fileName: string } {
  const lower = url.split('?')[0]!.toLowerCase();
  if (lower.endsWith('.mov')) {
    return { mime: 'video/quicktime', fileName: 'video.mov' };
  }
  if (lower.endsWith('.webm')) {
    return { mime: 'video/webm', fileName: 'video.webm' };
  }
  if (lower.endsWith('.3gp')) {
    return { mime: 'video/3gpp', fileName: 'video.3gp' };
  }
  return { mime: 'video/mp4', fileName: 'video.mp4' };
}

@Injectable()
export class GrupoTesteService {
  private readonly logger = new Logger(GrupoTesteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly houseImages: HouseImageStorageService,
    private readonly wa: WhatsAppService,
  ) {}

  async list() {
    return this.prisma.grupoTesteMessage.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        description: true,
        imageUrls: true,
        videoUrl: true,
        targetGroupJid: true,
        status: true,
        sentAt: true,
        whatsappError: true,
        createdAt: true,
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  async create(
    adminUserId: string,
    body: { description: string; targetGroupJid?: string },
    imageFiles: Express.Multer.File[],
    videoFile: Express.Multer.File | null,
  ) {
    const description = body.description?.trim() ?? '';
    if (description.length < 3) {
      throw new BadRequestException('A descrição deve ter pelo menos 3 caracteres.');
    }
    if (description.length > 8000) {
      throw new BadRequestException('Descrição demasiado longa (máx. 8000).');
    }
    const imgs = imageFiles?.length ? imageFiles.slice(0, 6) : [];
    if (imgs.length > 6) {
      throw new BadRequestException('No máximo 6 imagens.');
    }
    if (!imgs.length && !videoFile) {
      throw new BadRequestException('Envia pelo menos 1 imagem ou 1 vídeo.');
    }

    const imageUrls: string[] = [];
    for (const f of imgs) {
      const { publicUrl } = await this.houseImages.processHouseImageForListing(f);
      imageUrls.push(publicUrl);
      if (f.path) {
        await unlink(f.path).catch(() => undefined);
      }
    }

    let videoUrl: string | null = null;
    if (videoFile) {
      const v = await this.houseImages.storeHouseVideo(videoFile);
      videoUrl = v.publicUrl;
      if (videoFile.path) {
        await unlink(videoFile.path).catch(() => undefined);
      }
    }

    const targetGroupJid = body.targetGroupJid?.trim() || null;

    return this.prisma.grupoTesteMessage.create({
      data: {
        description,
        imageUrls,
        videoUrl,
        targetGroupJid: targetGroupJid || null,
        status: GrupoTesteMessageStatus.PENDING,
        createdById: adminUserId,
      },
      select: {
        id: true,
        description: true,
        imageUrls: true,
        videoUrl: true,
        targetGroupJid: true,
        status: true,
        createdAt: true,
      },
    });
  }

  async send(id: string, groupJidRaw: string) {
    const groupJid = normalizeGroupJid(groupJidRaw);
    const row = await this.prisma.grupoTesteMessage.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException('Mensagem não encontrada.');
    }
    if (row.status === GrupoTesteMessageStatus.SENT) {
      throw new BadRequestException('Esta mensagem já foi enviada.');
    }
    if (row.status === GrupoTesteMessageStatus.SENDING) {
      throw new BadRequestException(
        'Envio em curso ou interrompido. Aguarda ou tenta mais tarde.',
      );
    }

    await this.prisma.grupoTesteMessage.update({
      where: { id },
      data: {
        status: GrupoTesteMessageStatus.SENDING,
        whatsappError: null,
        targetGroupJid: groupJid,
      },
    });

    try {
      await this.wa.sendText(groupJid, row.description, { requireDelivery: true });
      await sleep(650);

      let idx = 0;
      for (const url of row.imageUrls) {
        idx += 1;
        const abs = toAbsoluteMediaUrl(url);
        await this.wa.sendMedia({
          to: groupJid,
          caption: idx === 1 ? '' : '',
          mediaUrl: abs,
          mimeType: 'image/webp',
          fileName: `imagem-${idx}.webp`,
          mediaType: 'image',
          requireDelivery: true,
        });
        await sleep(650);
      }

      if (row.videoUrl) {
        const abs = toAbsoluteMediaUrl(row.videoUrl);
        const { mime, fileName } = videoMimeFromUrl(abs);
        await this.wa.sendMedia({
          to: groupJid,
          caption: '',
          mediaUrl: abs,
          mimeType: mime,
          fileName,
          mediaType: 'video',
          requireDelivery: true,
        });
      }

      await this.prisma.grupoTesteMessage.update({
        where: { id },
        data: {
          status: GrupoTesteMessageStatus.SENT,
          sentAt: new Date(),
          whatsappError: null,
        },
      });

      return { ok: true as const, id, status: GrupoTesteMessageStatus.SENT };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Falha ao enviar para o WhatsApp.';
      this.logger.error(`Grupo teste send ${id}: ${message}`, err);
      await this.prisma.grupoTesteMessage.update({
        where: { id },
        data: {
          status: GrupoTesteMessageStatus.FAILED,
          whatsappError: message.slice(0, 4000),
        },
      });
      throw err;
    }
  }
}

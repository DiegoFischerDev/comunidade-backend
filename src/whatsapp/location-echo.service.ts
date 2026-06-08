import { Injectable, Logger } from '@nestjs/common';
import { IngestLocationEchoDto } from './dto/ingest-location-echo.dto';
import { WhatsAppService } from './whatsapp.service';

const STATIC_LOCATION_REPLY = 'Envie sua localização em tempo real';
const DEDUPE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class LocationEchoService {
  private readonly logger = new Logger(LocationEchoService.name);
  /** messageId (ou chave composta) → timestamp ms */
  private readonly processedKeys = new Map<string, number>();

  constructor(private readonly wa: WhatsAppService) {}

  isEnabled(): boolean {
    const raw = (process.env.LOCATION_ECHO_ENABLED || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(raw);
  }

  private buildDedupeKey(dto: IngestLocationEchoDto): string {
    const id = dto.externalMessageId?.trim();
    // Live location reutiliza o mesmo message id em cada update GPS — só uma resposta.
    if (id) return id;
    return `${dto.chatJid}|${dto.locationKind}|${dto.latitude}|${dto.longitude}`;
  }

  /** true se já processámos esta mensagem (webhook duplicado / duas instâncias). */
  private isDuplicate(key: string): boolean {
    if (!key) return false;
    const now = Date.now();
    for (const [k, ts] of this.processedKeys) {
      if (now - ts > DEDUPE_TTL_MS) this.processedKeys.delete(k);
    }
    const prev = this.processedKeys.get(key);
    if (prev != null && now - prev < DEDUPE_TTL_MS) return true;
    this.processedKeys.set(key, now);
    return false;
  }

  private formatLiveEchoMessage(dto: IngestLocationEchoDto): string {
    const lines = [
      '📍 *Localização em tempo real (teste)*',
      '',
      `Latitude: ${dto.latitude}`,
      `Longitude: ${dto.longitude}`,
    ];

    if (dto.name?.trim()) {
      lines.push(`Nome: ${dto.name.trim()}`);
    }
    if (dto.address?.trim()) {
      lines.push(`Morada: ${dto.address.trim()}`);
    }
    if (dto.accuracyInMeters != null && Number.isFinite(dto.accuracyInMeters)) {
      lines.push(`Precisão: ${dto.accuracyInMeters} m`);
    }
    if (dto.sequenceNumber != null && Number.isFinite(dto.sequenceNumber)) {
      lines.push(`Sequência: ${dto.sequenceNumber}`);
    }

    return lines.join('\n');
  }

  async ingest(
    dto: IngestLocationEchoDto,
  ): Promise<{ ok: true; status: string; echoed?: boolean }> {
    if (!this.isEnabled()) {
      return { ok: true, status: 'disabled' };
    }

    const chatJid = dto.chatJid.trim();
    if (!chatJid) {
      return { ok: true, status: 'ignored_no_chat' };
    }

    const dedupeKey = this.buildDedupeKey(dto);
    if (this.isDuplicate(dedupeKey)) {
      return { ok: true, status: 'ignored_duplicate' };
    }

    const sendOpts = {
      requireDelivery: false as const,
      preferredInstance: dto.instance?.trim() || undefined,
    };

    if (dto.locationKind !== 'live') {
      try {
        await this.wa.sendText(chatJid, STATIC_LOCATION_REPLY, sendOpts);
        this.logger.log(`Localização estática rejeitada (${chatJid})`);
        return { ok: true, status: 'rejected_static', echoed: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Erro desconhecido';
        this.logger.warn(`Rejeição estática falhou (${chatJid}): ${message}`);
        return { ok: true, status: 'send_failed' };
      }
    }

    const text = this.formatLiveEchoMessage(dto);

    try {
      await this.wa.sendText(chatJid, text, sendOpts);
      this.logger.log(
        `Location echo enviado para ${chatJid} (live, ${dto.latitude}, ${dto.longitude})`,
      );
      return { ok: true, status: 'echoed', echoed: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      this.logger.warn(`Location echo falhou (${chatJid}): ${message}`);
      return { ok: true, status: 'send_failed' };
    }
  }
}

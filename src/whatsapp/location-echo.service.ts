import { Injectable, Logger } from '@nestjs/common';
import { IngestLocationEchoDto } from './dto/ingest-location-echo.dto';
import { WhatsAppService } from './whatsapp.service';

@Injectable()
export class LocationEchoService {
  private readonly logger = new Logger(LocationEchoService.name);

  constructor(private readonly wa: WhatsAppService) {}

  isEnabled(): boolean {
    const raw = (process.env.LOCATION_ECHO_ENABLED || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(raw);
  }

  private formatEchoMessage(dto: IngestLocationEchoDto): string {
    const kindLabel =
      dto.locationKind === 'live' ? 'em tempo real' : 'estática';
    const lines = [
      '📍 *Localização recebida (teste)*',
      '',
      `Tipo: ${kindLabel}`,
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
      lines.push(`Sequência (live): ${dto.sequenceNumber}`);
    }
    if (dto.senderNumber?.trim()) {
      lines.push(`Remetente: ${dto.senderNumber.trim()}`);
    }

    lines.push(
      '',
      `Maps: https://www.google.com/maps?q=${dto.latitude},${dto.longitude}`,
    );

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

    const text = this.formatEchoMessage(dto);

    try {
      await this.wa.sendText(chatJid, text, {
        requireDelivery: false,
        preferredInstance: dto.instance?.trim() || undefined,
      });
      this.logger.log(
        `Location echo enviado para ${chatJid} (${dto.locationKind}, ${dto.latitude}, ${dto.longitude})`,
      );
      return { ok: true, status: 'echoed', echoed: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      this.logger.warn(`Location echo falhou (${chatJid}): ${message}`);
      return { ok: true, status: 'send_failed' };
    }
  }
}

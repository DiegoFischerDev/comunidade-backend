import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Payload enviado pelo receiver (whatsapp-evolution-verify) para cada mensagem de grupo. */
export class IngestMessageDto {
  @IsString()
  @MaxLength(120)
  groupJid!: string;

  /** Número de quem enviou (apenas dígitos ou JID; é normalizado no serviço). */
  @IsString()
  @MaxLength(120)
  senderNumber!: string;

  /** Texto do anúncio ou legenda da mídia. Pode ser vazio (mídia sem legenda). */
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalMessageId?: string;

  /** Tipo da mensagem: 'text' (omissão), 'image' ou 'video'. */
  @IsOptional()
  @IsString()
  @IsIn(['text', 'image', 'video'])
  kind?: 'text' | 'image' | 'video';

  /** Base64 da mídia (quando Webhook Base64 está ativo na Evolution). Pode ser grande (vídeo). */
  @IsOptional()
  @IsString()
  base64?: string;

  /** Nome da instância Evolution (fallback: backend busca o base64 via getBase64FromMediaMessage). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  instance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  mimeType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  fileName?: string;

  /** Momento de envio no WhatsApp (Evolution messageTimestamp, em segundos Unix). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  messageTimestamp?: number;
}

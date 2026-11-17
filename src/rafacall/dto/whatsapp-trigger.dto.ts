import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Payload do receiver (wa-verify): admin envia gatilho na DM → link para o destinatário. */
export class RafacallWhatsappTriggerDto {
  /** Número do cliente (destinatário da conversa). */
  @IsString()
  @MaxLength(120)
  recipientNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  text?: string;

  /** Nota de voz, imagem, vídeo ou documento enviados pelo admin, sem texto. */
  @IsOptional()
  @IsIn(['audio', 'image', 'video', 'document', 'sticker'])
  kind?: 'audio' | 'image' | 'video' | 'document' | 'sticker';

  /** Deve ser true — só processamos mensagens enviadas pelo admin (fromMe). */
  @IsOptional()
  @IsBoolean()
  fromMe?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  instance?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalMessageId?: string;
}

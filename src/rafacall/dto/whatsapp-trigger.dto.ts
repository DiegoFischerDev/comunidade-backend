import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Payload do receiver (wa-verify): admin envia gatilho na DM → link para o destinatário. */
export class RafacallWhatsappTriggerDto {
  /** Número do cliente (destinatário da conversa). */
  @IsString()
  @MaxLength(120)
  recipientNumber!: string;

  @IsString()
  @MaxLength(8000)
  text!: string;

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

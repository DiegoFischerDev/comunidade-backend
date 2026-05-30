import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Payload enviado pelo receiver (whatsapp-evolution-verify) para cada mensagem de grupo. */
export class IngestMessageDto {
  @IsString()
  @MaxLength(120)
  groupJid!: string;

  /** Número de quem enviou (apenas dígitos ou JID; é normalizado no serviço). */
  @IsString()
  @MaxLength(120)
  senderNumber!: string;

  @IsString()
  @MaxLength(8000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalMessageId?: string;
}

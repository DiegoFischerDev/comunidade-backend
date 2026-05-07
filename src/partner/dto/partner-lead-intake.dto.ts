import { IsOptional, IsString, MinLength } from 'class-validator';

export class PartnerLeadIntakeDto {
  @IsString()
  @MinLength(8)
  whatsapp!: string;

  @IsString()
  @MinLength(3)
  message!: string;

  @IsOptional()
  @IsString()
  evolutionInstance?: string;

  /** Nome do contacto vindo do WhatsApp/Evolution (pushName/notifyName). */
  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  messageId?: string;
}

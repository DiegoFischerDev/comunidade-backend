import { IsOptional, IsString, MinLength } from 'class-validator';

/** Pelo menos um campo deve ser enviado; validação extra no serviço. */
export class UpdatePartnerShareLinkDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Indica um título.' })
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Indica um número de WhatsApp válido.' })
  whatsapp?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Indica a frase para o WhatsApp.' })
  whatsappPhrase?: string;

  @IsOptional()
  @IsString()
  destinationUrl?: string;
}

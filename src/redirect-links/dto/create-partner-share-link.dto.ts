import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePartnerShareLinkDto {
  @IsString()
  @MinLength(1, { message: 'Indica um título.' })
  title: string;

  /** URL externa (http/https). Se definida, whatsapp e frase não são necessários. */
  @IsOptional()
  @IsString()
  destinationUrl?: string;

  /** Número com ou sem +351 / espaços — normalizado no servidor. */
  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsOptional()
  @IsString()
  whatsappPhrase?: string;
}

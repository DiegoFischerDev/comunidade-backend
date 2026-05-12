import { IsString, MinLength } from 'class-validator';

export class CreatePartnerShareLinkDto {
  @IsString()
  @MinLength(1, { message: 'Indica um título.' })
  title: string;

  /** Número com ou sem +351 / espaços — normalizado no servidor. */
  @IsString()
  @MinLength(8, { message: 'Indica um número de WhatsApp válido.' })
  whatsapp: string;

  @IsString()
  @MinLength(1, { message: 'Indica a frase para o WhatsApp.' })
  whatsappPhrase: string;
}

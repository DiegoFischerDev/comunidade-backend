import { IsIn, IsString, IsUrl, MinLength } from 'class-validator';

/**
 * Novo fluxo guest do RafaCall: só pede Nome + WhatsApp.
 * Não cria conta de utilizador. O booking é associado ao número de WhatsApp.
 */
export class CreateGuestRafacallSessionDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(8)
  whatsapp!: string;

  @IsString()
  @IsUrl()
  successUrl!: string;

  @IsString()
  @IsUrl()
  cancelUrl!: string;

  @IsIn(['card', 'mbway', 'pix'])
  paymentMethod!: 'card' | 'mbway' | 'pix';
}

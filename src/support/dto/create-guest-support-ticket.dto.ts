import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateGuestSupportTicketDto {
  @IsString({ message: 'name deve ser string.' })
  @MinLength(2, { message: 'Nome é obrigatório.' })
  @MaxLength(120, { message: 'Nome muito longo.' })
  name!: string;

  @IsString({ message: 'whatsapp deve ser string.' })
  @MinLength(8, { message: 'WhatsApp inválido.' })
  @MaxLength(32, { message: 'WhatsApp inválido.' })
  whatsapp!: string;

  @IsString({ message: 'message deve ser string.' })
  @MinLength(1, { message: 'Mensagem é obrigatória.' })
  @MaxLength(4000, { message: 'Mensagem muito longa (máx 4000).' })
  message!: string;
}

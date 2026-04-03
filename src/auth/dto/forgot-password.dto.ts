import { IsString, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsString()
  @MinLength(1, { message: 'WhatsApp é obrigatório' })
  whatsapp: string;
}

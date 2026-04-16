import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(1, { message: 'WhatsApp é obrigatório' })
  whatsapp: string;

  @IsString()
  code: string;

  @IsString()
  @MinLength(6, { message: 'A nova senha deve ter no mínimo 6 caracteres' })
  newPassword: string;
}

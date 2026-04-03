import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1, { message: 'WhatsApp é obrigatório' })
  whatsapp: string;

  @IsString()
  @MinLength(1, { message: 'Senha é obrigatória' })
  password: string;
}

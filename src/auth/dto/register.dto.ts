import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  name: string;

  @IsString()
  @MinLength(6, { message: 'A senha deve ter no mínimo 6 caracteres' })
  password: string;

  @IsIn(['email', 'whatsapp'])
  contactMethod: 'email' | 'whatsapp';

  @IsOptional()
  @IsString()
  affiliateCode?: string;
}

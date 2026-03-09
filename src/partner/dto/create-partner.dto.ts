import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePartnerDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6, { message: 'A senha deve ter no mínimo 6 caracteres' })
  password: string;

  @IsString()
  name: string;

  @IsString()
  whatsapp: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;
}


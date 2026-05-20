import { Transform, Type } from 'class-transformer';
import { IsEmail, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePartnerDto {
  @IsString()
  @MinLength(6, { message: 'A senha deve ter no mínimo 6 caracteres' })
  password: string;

  @IsString()
  name: string;

  /** E-mail da conta (opcional). Se omitido ou vazio, o utilizador fica sem e-mail como nos fluxos só WhatsApp. */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined) return undefined;
    const s = String(value).trim();
    return s === '' ? undefined : s.toLowerCase();
  })
  @IsEmail({}, { message: 'Indica um e-mail válido ou deixa o campo vazio.' })
  email?: string;

  @IsString()
  whatsapp: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  @IsOptional()
  @IsString()
  fullDescription?: string;

  @IsOptional()
  @IsString()
  backgroundImageUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  rpmCommissionPercent?: number;
}


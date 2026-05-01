import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdatePartnerProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'O nome da empresa não pode ser vazio.' })
  name?: string;

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
  whatsapp?: string;

  @IsOptional()
  @IsString()
  backgroundImageUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  catalogImageUrls?: string[];

  @IsOptional()
  @IsString()
  catalogVideoUrl?: string;

  @IsOptional()
  @IsString()
  @ValidateIf((_o, v) => v !== undefined && v !== null && v !== '')
  @Matches(/^@.+$/, { message: 'O Instagram deve começar com @ (ex: @utilizador)' })
  instagram?: string;

  // Dados para faturação (Portugal)
  @IsOptional()
  @IsString()
  billingName?: string;

  @IsOptional()
  @IsString()
  billingNif?: string;

  @IsOptional()
  @IsString()
  billingAddress?: string;

  @IsOptional()
  @IsString()
  billingPostalCode?: string;
}


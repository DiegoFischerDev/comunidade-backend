import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Multipart POST pelo admin — campos opcionais.
 * Valores inválidos ou vazios são normalizados no serviço (cidade, tipologia, datas, etc.).
 */
export class AdminCreatePartnerHouseDto {
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'O título não pode ter mais de 120 caracteres.' })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'A descrição não pode ter mais de 2000 caracteres.' })
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'Cidade demasiado longa.' })
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40, { message: 'Tipologia demasiado longa.' })
  typology?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10, { message: 'Finalidade inválida.' })
  businessType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'Data inválida.' })
  availableFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40, { message: 'O valor da renda/preço é demasiado longo.' })
  priceEur?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'O valor da taxa de relocation é demasiado longo.' })
  relocationFeeEur?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4, { message: 'Valor de cauções inválido.' })
  caucoesCount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4, { message: 'Valor de rendas inválido.' })
  rendasEntradaCount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8, { message: 'Valor de mobilado inválido.' })
  furnished?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2, { message: 'Índice da foto principal inválido.' })
  coverImageIndex?: string;

  @IsOptional()
  @IsString()
  partnerId?: string;
}

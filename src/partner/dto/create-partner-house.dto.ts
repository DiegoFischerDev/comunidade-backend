import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Multipart envia "true" | "false" como texto. */
export const PARTNER_HOUSE_FURNISHED_VALUES = ['true', 'false'] as const;

export const PARTNER_HOUSE_TYPOLOGY_CODES = [
  'T1',
  'T2',
  'T3',
  'T4',
  'T5',
  'QUARTO_AP_COMPARTILHADO',
] as const;

export type PartnerHouseTypologyCode = (typeof PARTNER_HOUSE_TYPOLOGY_CODES)[number];

export const PARTNER_HOUSE_BUSINESS_TYPE_CODES = ['RENT', 'SALE'] as const;
export type PartnerHouseBusinessTypeCode = (typeof PARTNER_HOUSE_BUSINESS_TYPE_CODES)[number];

/** Valores 0–12 como string (multipart / select). */
export const PARTNER_HOUSE_ENTRADA_COUNT = Array.from({ length: 13 }, (_, i) =>
  String(i),
) as readonly string[];

export class CreatePartnerHouseDto {
  @IsString({ message: 'O título deve ser texto.' })
  @MinLength(3, { message: 'O título deve ter pelo menos 3 caracteres.' })
  @MaxLength(120, { message: 'O título não pode ter mais de 120 caracteres.' })
  title!: string;

  @IsString({ message: 'A descrição deve ser texto.' })
  @MinLength(10, { message: 'A descrição deve ter pelo menos 10 caracteres.' })
  @MaxLength(2000, { message: 'A descrição não pode ter mais de 2000 caracteres.' })
  description!: string;

  @IsString({ message: 'Indica a cidade.' })
  @MinLength(1, { message: 'Indica a cidade.' })
  @MaxLength(120, { message: 'O nome da cidade é demasiado longo.' })
  city!: string;

  @IsString({ message: 'Indica uma tipologia válida.' })
  @IsIn(PARTNER_HOUSE_TYPOLOGY_CODES as unknown as string[], {
    message: 'Tipologia inválida.',
  })
  typology!: PartnerHouseTypologyCode;

  @IsOptional()
  @IsString({ message: 'Indica uma finalidade válida.' })
  @IsIn(PARTNER_HOUSE_BUSINESS_TYPE_CODES as unknown as string[], {
    message: 'Finalidade inválida.',
  })
  businessType?: PartnerHouseBusinessTypeCode;

  @IsDateString(
    {},
    {
      message:
        'A data «Disponível em» é inválida. Usa o formato AAAA-MM-DD.',
    },
  )
  availableFrom!: string;

  @IsString({ message: 'Indica o valor da renda mensal.' })
  @MinLength(1, { message: 'Indica o valor da renda mensal.' })
  @MaxLength(40, { message: 'O valor da renda mensal é demasiado longo.' })
  priceEur!: string;

  /** Valor em euros (apenas número, ex. "500" ou "500,50") — obrigatório */
  @IsString({ message: 'Indica a taxa de relocation.' })
  @MinLength(1, { message: 'Indica a taxa de relocation.' })
  @MaxLength(20, { message: 'O valor da taxa de relocation é demasiado longo.' })
  relocationFeeEur!: string;

  @IsString({ message: 'Indica o número de cauções (0 a 12).' })
  @IsIn([...PARTNER_HOUSE_ENTRADA_COUNT] as unknown as string[], {
    message: 'Número de cauções inválido.',
  })
  caucoesCount!: string;

  @IsString({ message: 'Indica o número de rendas antecipadas (0 a 12).' })
  @IsIn([...PARTNER_HOUSE_ENTRADA_COUNT] as unknown as string[], {
    message: 'Número de rendas antecipadas inválido.',
  })
  rendasEntradaCount!: string;

  @IsString({ message: 'Indica se o imóvel é mobilado (sim ou não).' })
  @IsIn([...PARTNER_HOUSE_FURNISHED_VALUES] as unknown as string[], {
    message: 'Valor de «mobilado» inválido.',
  })
  furnished!: string;

  /** Índice 0–5 da foto principal entre as imagens enviadas (ordem de upload). Omissão = primeira. */
  @IsOptional()
  @IsString()
  @IsIn(['0', '1', '2', '3', '4', '5'], {
    message: 'Índice da foto principal inválido.',
  })
  coverImageIndex?: string;

  /** Apenas admin: imóvel fica titulado por este parceiro (categoria relocation). Omissão = conta relocation do admin. */
  @IsOptional()
  @IsString()
  partnerId?: string;
}

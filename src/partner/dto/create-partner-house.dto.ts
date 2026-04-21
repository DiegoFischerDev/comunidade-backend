import {
  IsDateString,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Multipart envia "true" | "false" como texto. */
export const PARTNER_HOUSE_FURNISHED_VALUES = ['true', 'false'] as const;

export const PARTNER_HOUSE_CITY_CODES = [
  'INTERIOR',
  'LISBOA',
  'PORTO',
  'BRAGA',
  'COIMBRA',
  'AVEIRO',
  'FARO',
  'ALGARVE',
  'EVORA',
  'VISEU',
] as const;

export type PartnerHouseCityCode = (typeof PARTNER_HOUSE_CITY_CODES)[number];

export const PARTNER_HOUSE_TYPOLOGY_CODES = [
  'T1',
  'T2',
  'T3',
  'T4',
  'T5',
  'QUARTO_AP_COMPARTILHADO',
] as const;

export type PartnerHouseTypologyCode = (typeof PARTNER_HOUSE_TYPOLOGY_CODES)[number];

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

  @IsString({ message: 'Indica uma cidade válida.' })
  @IsIn(PARTNER_HOUSE_CITY_CODES as unknown as string[], {
    message: 'Cidade inválida.',
  })
  city!: PartnerHouseCityCode;

  @IsString({ message: 'Indica uma tipologia válida.' })
  @IsIn(PARTNER_HOUSE_TYPOLOGY_CODES as unknown as string[], {
    message: 'Tipologia inválida.',
  })
  typology!: PartnerHouseTypologyCode;

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
}

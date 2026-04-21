import {
  IsDateString,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

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
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description!: string;

  @IsString()
  @IsIn(PARTNER_HOUSE_CITY_CODES as unknown as string[])
  city!: PartnerHouseCityCode;

  @IsString()
  @IsIn(PARTNER_HOUSE_TYPOLOGY_CODES as unknown as string[])
  typology!: PartnerHouseTypologyCode;

  @IsDateString()
  availableFrom!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  priceEur!: string;

  /** Valor em euros (apenas número, ex. "500" ou "500,50") — obrigatório */
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  relocationFeeEur!: string;

  @IsString()
  @IsIn([...PARTNER_HOUSE_ENTRADA_COUNT] as unknown as string[])
  caucoesCount!: string;

  @IsString()
  @IsIn([...PARTNER_HOUSE_ENTRADA_COUNT] as unknown as string[])
  rendasEntradaCount!: string;
}

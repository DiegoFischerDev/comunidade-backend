import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

  /** Opcional; não aparece na página pública Relocation */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  relocationFeeEur?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  requirements!: string;
}


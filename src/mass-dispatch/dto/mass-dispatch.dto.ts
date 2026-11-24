import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const MASS_DISPATCH_BOT_SLUGS = [
  'joana',
  'bruna',
  'gabi',
  'outros',
] as const;
export type MassDispatchBotSlug = (typeof MASS_DISPATCH_BOT_SLUGS)[number];

export const MASS_DISPATCH_TYPOLOGIES = [
  'QUARTO',
  'T0',
  'T1',
  'T2',
  'T3',
  'T4',
  'T5',
] as const;

export type MassDispatchFiltersDto = {
  bots?: MassDispatchBotSlug[];
  hasVisa?: boolean;
  typologies?: (typeof MASS_DISPATCH_TYPOLOGIES)[number][];
  preferredCityContains?: string;
  /** YYYY-MM-DD */
  immigrationFrom?: string;
  /** YYYY-MM-DD */
  immigrationTo?: string;
  immigrationImmediate?: boolean;
};

export class CreateMassCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  steps!: unknown[];

  /** Validação fina no service (`normalizeFilters`). */
  @IsObject()
  filters!: MassDispatchFiltersDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  minDelayMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxDelayMinutes?: number;
}

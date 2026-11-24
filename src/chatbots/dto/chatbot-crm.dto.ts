import { RafaCallCrmPropertyTypology } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  MinLength,
  ArrayMinSize,
  ValidateIf,
} from 'class-validator';
import { normalizeCrmPropertyTypologies } from '../../rafacall/rafacall-crm.constants';

export class CreateCrmLeadDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(8)
  whatsapp!: string;

  @IsOptional()
  @IsString()
  columnId?: string;
}

/** Mover lead de um CRM (Joana / Bruna / Gabi / Outros) para outro. */
export class TransferCrmLeadDto {
  @IsString()
  @MinLength(2)
  sourceSlug!: string;

  @IsString()
  @MinLength(1)
  sourceId!: string;

  @IsString()
  @MinLength(2)
  targetSlug!: string;
}

export class UpdateCrmLeadDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  guestName?: string;

  @IsOptional()
  @IsString()
  columnId?: string;

  @IsOptional()
  @IsBoolean()
  botEnabled?: boolean;

  @IsOptional()
  @IsString()
  crmComments?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  crmRequestSummary?: string | null;

  @IsOptional()
  @IsString()
  companyName?: string | null;

  @IsOptional()
  @IsString()
  instagramHandle?: string | null;

  @IsOptional()
  @IsString()
  campaignObjective?: string | null;

  @IsOptional()
  @IsString()
  subjectSummary?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(5_000_000)
  desiredHouseValue?: number | null;

  @IsOptional()
  @IsString()
  preferredCities?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Transform(({ value }) =>
    value === null ? [] : normalizeCrmPropertyTypologies(value),
  )
  @IsArray()
  @IsEnum(RafaCallCrmPropertyTypology, { each: true })
  propertyTypology?: RafaCallCrmPropertyTypology[] | null;
}

export class CreateCrmColumnDto {
  @IsString()
  @MinLength(2)
  label!: string;

  @IsOptional()
  @IsString()
  tone?: string | null;

  @IsOptional()
  @IsBoolean()
  pausesBot?: boolean;
}

export class UpdateCrmColumnDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  label?: string;

  @IsOptional()
  @IsString()
  tone?: string | null;

  @IsOptional()
  @IsBoolean()
  pausesBot?: boolean;

  @IsOptional()
  sortOrder?: number;
}

export class ReorderCrmColumnsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  columnIds!: string[];
}

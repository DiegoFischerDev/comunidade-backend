import { RafaCallCrmPropertyTypology } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ArrayMinSize,
  ValidateIf,
} from 'class-validator';

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
  @IsEnum(RafaCallCrmPropertyTypology)
  propertyTypology?: RafaCallCrmPropertyTypology | null;
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

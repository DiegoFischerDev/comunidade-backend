import { RafaCallCrmPropertyTypology, RafaCallCrmStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { normalizeCrmPropertyTypologies } from '../rafacall-crm.constants';

export class UpdateRafacallCrmDto {
  @IsOptional()
  @IsEnum(RafaCallCrmStatus)
  crmStatus?: RafaCallCrmStatus;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  crmComments?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/^(IMEDIATO|\d{4}-\d{2}-\d{2})$/i, {
    message: 'crmExpectedImmigrationAt deve ser YYYY-MM-DD ou IMEDIATO.',
  })
  crmExpectedImmigrationAt?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  videoCallStartsAtUtcIso?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  videoCallTimezone?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Transform(({ value }) =>
    value === null ? [] : normalizeCrmPropertyTypologies(value),
  )
  @IsArray()
  @IsEnum(RafaCallCrmPropertyTypology, { each: true })
  crmPropertyTypology?: RafaCallCrmPropertyTypology[] | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(120)
  crmPreferredCity?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsBoolean()
  crmHasPet?: boolean | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsBoolean()
  crmHasVisa?: boolean | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100_000)
  crmDesiredRent?: number | null;

  /** Chatbot Joana: true = On, false = Off. Vale em qualquer coluna. */
  @IsOptional()
  @IsBoolean()
  crmJoanaEnabled?: boolean;
}

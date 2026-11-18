import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { RafaCallCrmPropertyTypology } from '@prisma/client';
import { normalizeCrmPropertyTypologies } from '../rafacall-crm.constants';

export class CreateRafacallCrmClientDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(32)
  whatsapp!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/^(IMEDIATO|\d{4}-\d{2}-\d{2})$/i, {
    message: 'crmExpectedImmigrationAt deve ser YYYY-MM-DD ou IMEDIATO.',
  })
  crmExpectedImmigrationAt?: string | null;

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
}

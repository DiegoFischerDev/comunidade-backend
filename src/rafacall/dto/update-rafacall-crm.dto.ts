import { RafaCallCrmStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

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
}

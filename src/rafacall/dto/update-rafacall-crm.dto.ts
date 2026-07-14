import { RafaCallCrmStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateRafacallCrmDto {
  @IsOptional()
  @IsEnum(RafaCallCrmStatus)
  crmStatus?: RafaCallCrmStatus;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  comment?: string;
}

import { IsBoolean, IsDateString, IsOptional, ValidateIf } from 'class-validator';

export class UpdateUserRafacallDto {
  @IsOptional()
  @IsBoolean()
  rafaCallSchedulingUnlocked?: boolean;

  /** ISO 8601 ou `null` para limpar o fim do slot */
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsDateString()
  rafaCallSlotEndsAt?: string | null;
}

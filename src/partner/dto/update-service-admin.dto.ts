import { IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateServiceAdminDto {
  /** Comissão RPM em percentual (0-100). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  commissionPercent?: number;
}


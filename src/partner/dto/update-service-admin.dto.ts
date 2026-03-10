import { IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateServiceAdminDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  commissionEuro?: number;
}


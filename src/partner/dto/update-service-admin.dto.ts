import { IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateServiceAdminDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  commissionEuro?: number;

  /** Percentual de comissão (0-100), usado quando o serviço é "sob consulta". */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  commissionPercent?: number;
}


import { IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateServiceAdminDto {
  /** Comissão RPM: texto definido pelo admin, ex. "10%" ou "5 €". */
  @IsOptional()
  @IsString()
  commission?: string;

  /** Valor de cashback fixo em euros para este serviço. */
  @IsOptional()
  @IsNumber()
  cashbackEuro?: number;
}


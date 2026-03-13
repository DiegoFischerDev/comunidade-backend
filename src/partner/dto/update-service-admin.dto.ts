import { IsOptional, IsString } from 'class-validator';

export class UpdateServiceAdminDto {
  /** Comissão RPM: texto definido pelo admin, ex. "10%" ou "5 €". */
  @IsOptional()
  @IsString()
  commission?: string;
}


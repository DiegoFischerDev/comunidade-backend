import { IsISO8601, IsOptional } from 'class-validator';

export class UpdateNextContactDto {
  /**
   * ISO em UTC (ex.: 2026-05-28T14:30:00.000Z). Pode ser null/omitido para limpar.
   */
  @IsOptional()
  @IsISO8601({}, { message: 'Data inválida.' })
  nextContactAt?: string | null;
}


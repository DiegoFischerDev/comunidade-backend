import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdatePartnerAdminDto {
  /**
   * Slug da categoria do parceiro (constante do projeto). Aceita um dos valores definidos em
   * `partner-categories.ts` (`relocation`, `financiamento`, `outras`) ou `null` para limpar.
   */
  @IsOptional()
  @IsString()
  categorySlug?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  priority?: number;
}

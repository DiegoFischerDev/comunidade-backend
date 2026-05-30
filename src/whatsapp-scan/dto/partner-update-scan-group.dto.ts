import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

/** Parceiro: só pode alterar números monitorizados e estado ativo do seu grupo. */
export class PartnerUpdateScanGroupDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  monitoredNumbers?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

import { IsOptional, IsString, MaxLength } from 'class-validator';
import { UpdatePartnerHouseDto } from './update-partner-house.dto';

/** PATCH multipart pelo admin — iguais campos do parceiro. */
export class AdminUpdatePartnerHouseDto extends UpdatePartnerHouseDto {
  /** Reatribuir o anúncio para outro parceiro relocation (opcional). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  partnerId?: string;
}

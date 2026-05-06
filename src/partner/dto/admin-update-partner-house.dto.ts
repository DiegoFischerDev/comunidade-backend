import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { UpdatePartnerHouseDto } from './update-partner-house.dto';

const ADMIN_HOUSE_STATUS = ['AVAILABLE', 'RESERVED', 'UNAVAILABLE'] as const;

/** PATCH multipart pelo admin — iguais campos do parceiro + estado opcional. */
export class AdminUpdatePartnerHouseDto extends UpdatePartnerHouseDto {
  @IsOptional()
  @IsIn([...ADMIN_HOUSE_STATUS], {
    message: 'Estado inválido.',
  })
  status?: (typeof ADMIN_HOUSE_STATUS)[number];

  /** Reatribuir o anúncio para outro parceiro relocation (opcional). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  partnerId?: string;
}

import { IsOptional, IsString } from 'class-validator';

export class UpdatePartnerAdminDto {
  @IsOptional()
  @IsString()
  categoryId?: string | null;
}


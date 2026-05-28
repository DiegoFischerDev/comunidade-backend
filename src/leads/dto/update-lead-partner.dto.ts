import { IsOptional, IsString } from 'class-validator';

export class UpdateLeadPartnerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsOptional()
  @IsString()
  comment?: string | null;
}


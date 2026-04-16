import { IsOptional, IsString } from 'class-validator';

export class UpdateServiceCommissionDto {
  @IsOptional()
  @IsString()
  rpmCommissionEur?: string | null;
}


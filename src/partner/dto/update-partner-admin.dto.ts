import { IsOptional, IsString } from 'class-validator';
import { IsInt, Max, Min } from 'class-validator';

export class UpdatePartnerAdminDto {
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  priority?: number;
}


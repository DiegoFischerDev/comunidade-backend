import { IsBoolean, IsOptional, IsString, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  priceOnRequest?: boolean;

  @IsOptional()
  @ValidateIf((o) => !o.priceOnRequest)
  @IsString()
  price?: string;
}


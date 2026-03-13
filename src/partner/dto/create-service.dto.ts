import { IsBoolean, IsOptional, IsString, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateServiceDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  priceOnRequest?: boolean;

  @ValidateIf((o) => !o.priceOnRequest)
  @IsString()
  price?: string;
}


import { IsOptional, IsString } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  price?: string;
}


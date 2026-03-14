import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

export class UpdatePartnerProfileDto {
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  @IsOptional()
  @IsString()
  fullDescription?: string;

  @IsOptional()
  @IsString()
  backgroundImageUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  catalogImageUrls?: string[];
}


import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';

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

  @IsOptional()
  @IsString()
  @ValidateIf((_o, v) => v !== undefined && v !== null && v !== '')
  @Matches(/^@.+$/, { message: 'O Instagram deve começar com @ (ex: @utilizador)' })
  instagram?: string;
}


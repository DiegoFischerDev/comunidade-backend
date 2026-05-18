import { IsBoolean, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateRecommendedServiceDto {
  @IsString()
  @MinLength(1, { message: 'Título é obrigatório' })
  title: string;

  @IsString()
  @MinLength(1, { message: 'Link é obrigatório' })
  partnerShareLinkId: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

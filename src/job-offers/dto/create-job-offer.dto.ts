import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateJobOfferDto {
  @IsString()
  @MinLength(1, { message: 'Título é obrigatório' })
  title: string;

  @IsString()
  @MinLength(1, { message: 'Cidade é obrigatória' })
  city: string;

  @IsString()
  @MinLength(1, { message: 'Descrição é obrigatória' })
  description: string;

  @IsOptional()
  @IsDateString({}, { message: 'Data de publicação inválida' })
  publishedAt?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

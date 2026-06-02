import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { JobOfferContactDto } from './job-offer-contact.dto';

export class UpdateJobOfferDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Título é obrigatório' })
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Função é obrigatória' })
  jobFunction?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Cidade é obrigatória' })
  city?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Resumo pode ter no máximo 500 caracteres' })
  summary?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Descrição é obrigatória' })
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JobOfferContactDto)
  advertiserContacts?: JobOfferContactDto[];

  @IsOptional()
  @IsDateString({}, { message: 'Data de publicação inválida' })
  publishedAt?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

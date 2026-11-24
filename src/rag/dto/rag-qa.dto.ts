import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRagQaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  question!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  answer!: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  showInFaq?: boolean;
}

export class UpdateRagQaDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  question?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  answer?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  showInFaq?: boolean;
}

import { FinanceEntryKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateFinanceEntryDto {
  @IsEnum(FinanceEntryKind)
  kind!: FinanceEntryKind;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  /** Data civil YYYY-MM-DD */
  @IsString()
  @MinLength(8)
  paidAt!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  receiptImageUrl?: string | null;

  @IsOptional()
  @IsString()
  comment?: string | null;

  /** Só para receitas: WhatsApp do cliente (dígitos ou formatado). */
  @IsOptional()
  @IsString()
  whatsapp?: string | null;
}

export class UpdateFinanceEntryDto {
  @IsOptional()
  @IsEnum(FinanceEntryKind)
  kind?: FinanceEntryKind;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  paidAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsString()
  receiptImageUrl?: string | null;

  @IsOptional()
  @IsString()
  comment?: string | null;

  @IsOptional()
  @IsString()
  whatsapp?: string | null;
}

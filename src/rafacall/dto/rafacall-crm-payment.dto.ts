import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRafacallCrmPaymentDto {
  /** Data civil YYYY-MM-DD */
  @IsString()
  @MinLength(8)
  paidAt!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsString()
  @MinLength(1)
  receiptImageUrl!: string;

  @IsOptional()
  @IsString()
  comment?: string | null;
}

export class UpdateRafacallCrmPaymentDto {
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
  @MinLength(1)
  receiptImageUrl?: string;

  @IsOptional()
  @IsString()
  comment?: string | null;
}

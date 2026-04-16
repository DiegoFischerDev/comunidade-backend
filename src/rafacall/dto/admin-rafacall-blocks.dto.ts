import { IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminCreateRafacallBlockDto {
  @IsString()
  @IsNotEmpty()
  @IsISO8601()
  startsAtUtcIso!: string;

  @IsString()
  @IsNotEmpty()
  @IsISO8601()
  endsAtUtcIso!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}


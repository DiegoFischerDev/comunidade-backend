import { IsISO8601, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class AdminCreateRafacallBookingDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(32)
  whatsapp!: string;

  @IsString()
  @IsNotEmpty()
  @IsISO8601()
  startsAtUtcIso!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  tz!: string;
}

import { IsOptional, IsString, MinLength } from 'class-validator';

export class AdminManualLeadDto {
  @IsString()
  @MinLength(8)
  whatsapp!: string;

  @IsOptional()
  @IsString()
  interestComment?: string;
}

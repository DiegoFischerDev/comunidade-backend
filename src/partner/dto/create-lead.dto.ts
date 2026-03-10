import { IsOptional, IsString } from 'class-validator';

export class CreateLeadDto {
  @IsOptional()
  @IsString()
  source?: string;
}


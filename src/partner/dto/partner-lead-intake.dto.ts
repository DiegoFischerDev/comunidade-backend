import { IsOptional, IsString, MinLength } from 'class-validator';

export class PartnerLeadIntakeDto {
  @IsString()
  @MinLength(8)
  whatsapp!: string;

  @IsString()
  @MinLength(3)
  message!: string;

  @IsOptional()
  @IsString()
  evolutionInstance?: string;

  @IsOptional()
  @IsString()
  messageId?: string;
}

import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateJobOfferWhatsappScanDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  sourceTitle?: string;

  @IsOptional()
  @IsString()
  @Matches(/@g\.us$/i, {
    message: 'JID inválido (deve terminar em @g.us).',
  })
  @MaxLength(120)
  sourceGroupJid?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  monitoredNumbers?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  monitorAllMembers?: boolean;
}

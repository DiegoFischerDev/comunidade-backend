import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateJobOfferWhatsappRouteDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  sourceTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  destTitle?: string;

  @IsOptional()
  @IsString()
  @Matches(/@g\.us$/i, {
    message: 'JID inválido (deve terminar em @g.us).',
  })
  @MaxLength(120)
  sourceGroupJid?: string;

  @IsOptional()
  @IsString()
  @Matches(/@g\.us$/i, {
    message: 'JID inválido (deve terminar em @g.us).',
  })
  @MaxLength(120)
  destGroupJid?: string;

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

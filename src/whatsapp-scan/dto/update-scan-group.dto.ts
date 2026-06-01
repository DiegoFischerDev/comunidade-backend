import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateScanGroupDto {
  @IsOptional()
  @IsString()
  partnerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(/@(g\.us|newsletter)$/i, {
    message: 'JID inválido (deve terminar em @g.us ou @newsletter).',
  })
  @MaxLength(120)
  groupJid?: string;

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
  autoShareEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  monitorAllMembers?: boolean;
}

import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Payload enviado pelo wa-verify quando a instância recebe uma localização. */
export class IngestLocationEchoDto {
  /** JID do chat onde responder (DM @s.whatsapp.net ou grupo @g.us). */
  @IsString()
  @MaxLength(160)
  chatJid!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  senderNumber?: string;

  @IsString()
  @IsIn(['static', 'live'])
  locationKind!: 'static' | 'live';

  @Type(() => Number)
  @IsNumber()
  latitude!: number;

  @Type(() => Number)
  @IsNumber()
  longitude!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accuracyInMeters?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sequenceNumber?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalMessageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  instance?: string;
}

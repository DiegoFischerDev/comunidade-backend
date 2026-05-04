import { Transform } from 'class-transformer';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateHouseRelocationWhatsappGroupDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(8)
  @MaxLength(120)
  @Matches(/@g\.us$/i, {
    message: 'O código do grupo deve ser um JID WhatsApp (ex.: 120363…@g.us).',
  })
  groupJid!: string;

  @IsIn(['RENT', 'SALE'])
  businessType!: 'RENT' | 'SALE';
}

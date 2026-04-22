import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePartnerCommentDto {
  @IsString({ message: 'O comentário deve ser texto.' })
  @MinLength(1, { message: 'Escreve um comentário.' })
  @MaxLength(2000, { message: 'O comentário é demasiado longo (máx. 2000 caracteres).' })
  body: string;
}

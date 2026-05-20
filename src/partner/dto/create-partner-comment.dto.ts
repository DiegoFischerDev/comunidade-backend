import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePartnerCommentDto {
  @IsString({ message: 'O comentário deve ser texto.' })
  @MinLength(1, { message: 'Escreve um comentário.' })
  @MaxLength(2000, { message: 'O comentário é demasiado longo (máx. 2000 caracteres).' })
  body: string;

  /** Comentário a que isto responde (thread). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentId?: string;

  /** Nome opcional para visitantes (com autenticação o nome vem do perfil). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  guestName?: string;
}

import { IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsEmail({}, { message: 'E-mail inválido' })
  email?: string;
}


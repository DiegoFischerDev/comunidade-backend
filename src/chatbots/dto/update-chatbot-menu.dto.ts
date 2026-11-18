import { IsString, MinLength } from 'class-validator';

export class UpdateChatbotMenuDto {
  @IsString()
  @MinLength(20)
  menuText!: string;
}

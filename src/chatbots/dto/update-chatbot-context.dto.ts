import { IsString, MinLength } from 'class-validator';

export class UpdateChatbotContextDto {
  @IsString()
  @MinLength(20)
  contextText!: string;
}

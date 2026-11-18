import { IsArray } from 'class-validator';

export class UpdateChatbotWelcomeDto {
  @IsArray()
  steps!: unknown[];
}

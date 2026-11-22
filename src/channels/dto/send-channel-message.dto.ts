import { ChatbotChannel } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class SendChannelMessageDto {
  @IsEnum(ChatbotChannel)
  channel!: ChatbotChannel;

  @ValidateIf((value: SendChannelMessageDto) => value.template !== 'scheduling-link')
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text?: string;

  @IsOptional()
  @IsIn(['scheduling-link'])
  template?: 'scheduling-link';
}

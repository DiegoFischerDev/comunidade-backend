import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateChatbotChannelsDto {
  @IsOptional()
  @IsBoolean()
  whatsappEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  instagramEnabled?: boolean;
}

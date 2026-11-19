import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { ChatbotService } from './chatbot.service';
import { UpdateChatbotChannelsDto } from './dto/update-chatbot-channels.dto';
import { UpdateChatbotContextDto } from './dto/update-chatbot-context.dto';
import { UpdateChatbotMenuDto } from './dto/update-chatbot-menu.dto';
import { UpdateChatbotWelcomeDto } from './dto/update-chatbot-welcome.dto';

@Controller('chatbots')
export class ChatbotsController {
  constructor(private readonly chatbots: ChatbotService) {}

  @Get()
  @Roles(Role.ADMIN)
  list() {
    return this.chatbots.list();
  }

  @Get('menu')
  @Roles(Role.ADMIN)
  menu() {
    return this.chatbots.getMenuPreview();
  }

  @Patch('menu')
  @Roles(Role.ADMIN)
  updateMenu(@Body() dto: UpdateChatbotMenuDto) {
    return this.chatbots.updateMenuText(dto.menuText);
  }

  @Get('channels')
  @Roles(Role.ADMIN)
  channels() {
    return this.chatbots.getChannelFlags();
  }

  @Patch('channels')
  @Roles(Role.ADMIN)
  updateChannels(@Body() dto: UpdateChatbotChannelsDto) {
    return this.chatbots.updateChannelFlags({
      whatsappEnabled: dto.whatsappEnabled,
      instagramEnabled: dto.instagramEnabled,
    });
  }

  @Get(':slug')
  @Roles(Role.ADMIN)
  get(@Param('slug') slug: string) {
    return this.chatbots.getBySlug(slug);
  }

  @Get(':slug/context')
  @Roles(Role.ADMIN)
  context(@Param('slug') slug: string) {
    return this.chatbots.getBySlug(slug).then((bot) => ({
      contextText: bot.contextText,
    }));
  }

  @Patch(':slug/context')
  @Roles(Role.ADMIN)
  updateContext(@Param('slug') slug: string, @Body() dto: UpdateChatbotContextDto) {
    return this.chatbots.updateContext(slug, dto.contextText);
  }

  @Get(':slug/welcome')
  @Roles(Role.ADMIN)
  welcome(@Param('slug') slug: string) {
    return this.chatbots.getBySlug(slug).then((bot) => ({
      steps: bot.welcomeSteps,
    }));
  }

  @Patch(':slug/welcome')
  @Roles(Role.ADMIN)
  updateWelcome(@Param('slug') slug: string, @Body() dto: UpdateChatbotWelcomeDto) {
    return this.chatbots.updateWelcome(slug, dto.steps ?? []);
  }
}

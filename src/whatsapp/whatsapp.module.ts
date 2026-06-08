import { Module } from '@nestjs/common';
import { LocationEchoController } from './location-echo.controller';
import { LocationEchoService } from './location-echo.service';
import { WhatsAppService } from './whatsapp.service';

@Module({
  controllers: [LocationEchoController],
  providers: [WhatsAppService, LocationEchoService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}


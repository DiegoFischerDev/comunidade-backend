import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RafacallService } from './rafacall.service';
import { RafacallController } from './rafacall.controller';
import { CalcomWebhookController } from './calcom-webhook.controller';

@Module({
  imports: [PrismaModule],
  controllers: [RafacallController, CalcomWebhookController],
  providers: [RafacallService],
  exports: [RafacallService],
})
export class RafacallModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RafacallService } from './rafacall.service';
import { RafacallController } from './rafacall.controller';
import { CalendlyWebhookController } from './calendly-webhook.controller';

@Module({
  imports: [PrismaModule],
  controllers: [RafacallController, CalendlyWebhookController],
  providers: [RafacallService],
  exports: [RafacallService],
})
export class RafacallModule {}

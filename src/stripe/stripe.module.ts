import { Module, forwardRef } from '@nestjs/common';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AuthModule } from '../auth/auth.module';
import { PartnerModule } from '../partner/partner.module';

@Module({
  imports: [PrismaModule, WhatsAppModule, AuthModule, forwardRef(() => PartnerModule)],
  controllers: [StripeController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}

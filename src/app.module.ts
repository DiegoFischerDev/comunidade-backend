import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { PartnerModule } from './partner/partner.module';
import { UsersModule } from './users/users.module';
import { UploadsModule } from './uploads/uploads.module';
import { StripeModule } from './stripe/stripe.module';
import { AffiliateModule } from './affiliate/affiliate.module';
import { RafacallModule } from './rafacall/rafacall.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { SupportModule } from './support/support.module';
import { ChecklistModule } from './checklist/checklist.module';
import { GrupoTesteModule } from './grupo-teste/grupo-teste.module';
import { RedirectLinksModule } from './redirect-links/redirect-links.module';
import { RecommendedServicesModule } from './recommended-services/recommended-services.module';
import { FinancingQuizModule } from './financing-quiz/financing-quiz.module';
import { LeadsModule } from './leads/leads.module';
import { LeadDocumentsModule } from './lead-documents/lead-documents.module';
import { WhatsappScanModule } from './whatsapp-scan/whatsapp-scan.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    PartnerModule,
    UsersModule,
    UploadsModule,
    StripeModule,
    AffiliateModule,
    RafacallModule,
    WhatsAppModule,
    SupportModule,
    ChecklistModule,
    GrupoTesteModule,
    RedirectLinksModule,
    RecommendedServicesModule,
    LeadsModule,
    LeadDocumentsModule,
    FinancingQuizModule,
    WhatsappScanModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}

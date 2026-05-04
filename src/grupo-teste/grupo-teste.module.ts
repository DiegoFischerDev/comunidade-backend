import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PartnerModule } from '../partner/partner.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { GrupoTesteController } from './grupo-teste.controller';
import { GrupoTesteService } from './grupo-teste.service';

@Module({
  imports: [PrismaModule, PartnerModule, WhatsAppModule],
  controllers: [GrupoTesteController],
  providers: [GrupoTesteService],
})
export class GrupoTesteModule {}

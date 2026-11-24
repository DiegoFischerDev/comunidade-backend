import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminMassDispatchController } from './admin-mass-dispatch.controller';
import { MassDispatchAudienceService } from './mass-dispatch-audience.service';
import { MassDispatchService } from './mass-dispatch.service';
import { MassDispatchVariationsService } from './mass-dispatch-variations.service';
import { MassDispatchWorker } from './mass-dispatch.worker';

@Module({
  imports: [PrismaModule, ChannelsModule],
  controllers: [AdminMassDispatchController],
  providers: [
    MassDispatchAudienceService,
    MassDispatchVariationsService,
    MassDispatchService,
    MassDispatchWorker,
  ],
})
export class MassDispatchModule {}

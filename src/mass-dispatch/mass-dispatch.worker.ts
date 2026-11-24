import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MassDispatchService } from './mass-dispatch.service';

@Injectable()
export class MassDispatchWorker {
  private readonly logger = new Logger(MassDispatchWorker.name);

  constructor(private readonly service: MassDispatchService) {}

  @Interval(15_000)
  async tick(): Promise<void> {
    try {
      await this.service.processDue();
    } catch (err) {
      this.logger.warn(
        `Worker disparo: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

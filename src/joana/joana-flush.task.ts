import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { JoanaService } from './joana.service';

@Injectable()
export class JoanaFlushTask {
  constructor(private readonly joana: JoanaService) {}

  /** Junta mensagens paradas há pelo menos o debounce e responde uma vez. */
  @Interval(5_000)
  async flush() {
    await this.joana.flushDue();
  }
}

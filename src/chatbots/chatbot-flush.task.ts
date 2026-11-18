import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ChatbotRouterService } from './chatbot-router.service';

@Injectable()
export class ChatbotFlushTask {
  constructor(private readonly router: ChatbotRouterService) {}

  /** Junta mensagens paradas há pelo menos o debounce e responde uma vez. */
  @Interval(5_000)
  async flush() {
    await this.router.flushDue();
  }
}

import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { RafacallService } from './rafacall.service';

@Controller('rafacall')
export class RafacallController {
  constructor(private readonly rafacallService: RafacallService) {}

  /**
   * URL pública do evento Cal.com. Lida em runtime no backend — permite usar só o .env da VPS
   * (ex.: mesma variável NEXT_PUBLIC_CALCOM_EMBED_URL injetada no serviço backend) sem rebuild do Next.
   */
  @Public()
  @Get('cal-embed-url')
  calEmbedUrl() {
    const url =
      process.env.CALCOM_EMBED_URL?.trim() ||
      process.env.NEXT_PUBLIC_CALCOM_EMBED_URL?.trim() ||
      '';
    return { url: url || null };
  }

  @Get('status')
  async status(@CurrentUser() user: { id: string }) {
    const s = await this.rafacallService.getStatus(user.id);
    if (!s) {
      return { error: 'not_found' };
    }
    return s;
  }
}

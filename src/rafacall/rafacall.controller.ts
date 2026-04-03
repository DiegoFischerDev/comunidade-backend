import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { RafacallService } from './rafacall.service';

@Controller('rafacall')
export class RafacallController {
  constructor(private readonly rafacallService: RafacallService) {}

  @Get('status')
  async status(@CurrentUser() user: { id: string }) {
    const s = await this.rafacallService.getStatus(user.id);
    if (!s) {
      return { error: 'not_found' };
    }
    return s;
  }
}

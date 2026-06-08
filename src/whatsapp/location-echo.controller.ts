import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Post,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { IngestLocationEchoDto } from './dto/ingest-location-echo.dto';
import { LocationEchoService } from './location-echo.service';

@Controller('whatsapp/location-echo')
export class LocationEchoController {
  constructor(private readonly locationEcho: LocationEchoService) {}

  /**
   * Eco de localização (teste). Chamado pelo wa-verify quando a Evolution recebe
   * locationMessage ou liveLocationMessage.
   */
  @Public()
  @Post('ingest')
  ingest(
    @Body() dto: IngestLocationEchoDto,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    const expected = (process.env.COMMUNITY_INTERNAL_SECRET || '').trim();
    if (!expected || (internalSecret ?? '').trim() !== expected) {
      throw new ForbiddenException('Segredo interno inválido.');
    }
    return this.locationEcho.ingest(dto);
  }
}

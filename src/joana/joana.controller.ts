import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { UpdateJoanaContextDto } from './dto/update-joana-context.dto';
import { JoanaService } from './joana.service';

@Controller('joana')
export class JoanaController {
  constructor(private readonly joana: JoanaService) {}

  @Get('context')
  @Roles(Role.ADMIN)
  context() {
    return this.joana.getContext();
  }

  @Patch('context')
  @Roles(Role.ADMIN)
  updateContext(@Body() dto: UpdateJoanaContextDto) {
    return this.joana.updateContext(dto.contextText);
  }
}

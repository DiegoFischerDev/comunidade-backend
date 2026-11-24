import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import {
  CreateMassCampaignDto,
  MassDispatchFiltersDto,
  MASS_DISPATCH_BOT_SLUGS,
  MASS_DISPATCH_TYPOLOGIES,
} from './dto/mass-dispatch.dto';
import { MassDispatchService } from './mass-dispatch.service';

@Controller('admin/mass-dispatch')
@Roles(Role.ADMIN)
export class AdminMassDispatchController {
  constructor(private readonly service: MassDispatchService) {}

  @Get('preview')
  preview(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.preview(this.parseFiltersFromQuery(query));
  }

  @Post('campaigns')
  create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateMassCampaignDto,
  ) {
    return this.service.create(user.id, dto);
  }

  @Get('campaigns')
  list() {
    return this.service.list();
  }

  @Get('campaigns/:id')
  get(@Param('id') id: string) {
    return this.service.getById(id.trim());
  }

  @Post('campaigns/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id.trim());
  }

  private parseFiltersFromQuery(
    query: Record<string, string | string[] | undefined>,
  ): MassDispatchFiltersDto {
    const filters: MassDispatchFiltersDto = {};

    const botsRaw = this.asArray(query.bots ?? query['bots[]']);
    if (botsRaw.length > 0) {
      filters.bots = botsRaw.filter((b): b is (typeof MASS_DISPATCH_BOT_SLUGS)[number] =>
        (MASS_DISPATCH_BOT_SLUGS as readonly string[]).includes(b),
      );
    }

    if (query.hasVisa === 'true') filters.hasVisa = true;
    if (query.hasVisa === 'false') filters.hasVisa = false;

    const typologiesRaw = this.asArray(query.typologies ?? query['typologies[]']);
    if (typologiesRaw.length > 0) {
      filters.typologies = typologiesRaw.filter(
        (t): t is (typeof MASS_DISPATCH_TYPOLOGIES)[number] =>
          (MASS_DISPATCH_TYPOLOGIES as readonly string[]).includes(t),
      );
    }

    const city = this.asString(query.preferredCityContains);
    if (city) filters.preferredCityContains = city;

    const from = this.asString(query.immigrationFrom);
    if (from) filters.immigrationFrom = from;
    const to = this.asString(query.immigrationTo);
    if (to) filters.immigrationTo = to;

    if (query.immigrationImmediate === 'true') {
      filters.immigrationImmediate = true;
    }

    return filters;
  }

  private asString(value: string | string[] | undefined): string {
    if (Array.isArray(value)) return (value[0] || '').trim();
    return (value || '').trim();
  }

  private asArray(value: string | string[] | undefined): string[] {
    if (value == null) return [];
    if (Array.isArray(value)) {
      return value.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
    }
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
}

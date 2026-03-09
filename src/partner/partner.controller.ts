import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { PartnerService } from './partner.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@Controller('partners')
export class PartnerController {
  constructor(private readonly partnerService: PartnerService) {}

  @Get()
  @Roles(Role.ADMIN)
  async list() {
    return this.partnerService.listPartners();
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(@Body() dto: CreatePartnerDto) {
    return this.partnerService.createPartner(dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async delete(@Param('id') id: string) {
    return this.partnerService.deletePartner(id);
  }
}


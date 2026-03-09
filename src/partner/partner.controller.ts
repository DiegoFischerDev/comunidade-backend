import { Body, Controller, Post } from '@nestjs/common';
import { PartnerService } from './partner.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@Controller('partners')
export class PartnerController {
  constructor(private readonly partnerService: PartnerService) {}

  @Post()
  @Roles(Role.ADMIN)
  async create(@Body() dto: CreatePartnerDto) {
    return this.partnerService.createPartner(dto);
  }
}


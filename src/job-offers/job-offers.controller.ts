import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { CreateJobOfferDto } from './dto/create-job-offer.dto';
import { ParseJobOfferFromTextDto } from './dto/parse-job-offer-from-text.dto';
import { UpdateJobOfferDto } from './dto/update-job-offer.dto';
import { JobOffersService } from './job-offers.service';

@Controller('job-offers')
export class JobOffersController {
  constructor(private readonly jobOffersService: JobOffersService) {}

  @Public()
  @Get()
  listPublic() {
    return this.jobOffersService.listPublic();
  }

  @Get('admin')
  @Roles(Role.ADMIN)
  adminList() {
    return this.jobOffersService.adminList();
  }

  @Post('admin/parse')
  @Roles(Role.ADMIN)
  adminParseFromText(@Body() dto: ParseJobOfferFromTextDto) {
    return this.jobOffersService.adminParseFromText(dto.text);
  }

  @Post('admin')
  @Roles(Role.ADMIN)
  adminCreate(@Body() dto: CreateJobOfferDto) {
    return this.jobOffersService.adminCreate(dto);
  }

  @Patch('admin/:id')
  @Roles(Role.ADMIN)
  adminUpdate(@Param('id') id: string, @Body() dto: UpdateJobOfferDto) {
    return this.jobOffersService.adminUpdate(id, dto);
  }

  @Delete('admin/:id')
  @Roles(Role.ADMIN)
  adminDelete(@Param('id') id: string) {
    return this.jobOffersService.adminDelete(id);
  }
}

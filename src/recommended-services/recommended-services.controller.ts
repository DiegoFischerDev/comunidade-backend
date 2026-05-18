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
import { RecommendedServicesService } from './recommended-services.service';
import { CreateRecommendedServiceDto } from './dto/create-recommended-service.dto';
import { UpdateRecommendedServiceDto } from './dto/update-recommended-service.dto';

@Controller('recommended-services')
export class RecommendedServicesController {
  constructor(
    private readonly recommendedServicesService: RecommendedServicesService,
  ) {}

  @Public()
  @Get()
  listPublic() {
    return this.recommendedServicesService.listPublic();
  }

  @Get('admin')
  @Roles(Role.ADMIN)
  adminList() {
    return this.recommendedServicesService.adminList();
  }

  @Get('admin/available-links')
  @Roles(Role.ADMIN)
  adminAvailableLinks() {
    return this.recommendedServicesService.adminAvailableLinks();
  }

  @Post('admin')
  @Roles(Role.ADMIN)
  adminCreate(@Body() dto: CreateRecommendedServiceDto) {
    return this.recommendedServicesService.adminCreate(dto);
  }

  @Patch('admin/:id')
  @Roles(Role.ADMIN)
  adminUpdate(
    @Param('id') id: string,
    @Body() dto: UpdateRecommendedServiceDto,
  ) {
    return this.recommendedServicesService.adminUpdate(id, dto);
  }

  @Delete('admin/:id')
  @Roles(Role.ADMIN)
  adminDelete(@Param('id') id: string) {
    return this.recommendedServicesService.adminDelete(id);
  }
}

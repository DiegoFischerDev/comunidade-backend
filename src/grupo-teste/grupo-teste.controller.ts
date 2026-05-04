import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { GrupoTesteService } from './grupo-teste.service';
import { CreateGrupoTesteBodyDto } from './dto/create-grupo-teste-body.dto';
import { SendGrupoTesteDto } from './dto/send-grupo-teste.dto';

@Controller('admin/grupo-teste')
@Roles(Role.ADMIN)
export class GrupoTesteController {
  constructor(private readonly grupoTeste: GrupoTesteService) {}

  @Get()
  list() {
    return this.grupoTeste.list();
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 6 },
        { name: 'video', maxCount: 1 },
      ],
      {
        limits: {
          files: 7,
          /** Vídeos ~3 min em HD podem ultrapassar 48MB; alinhar com Nginx `client_max_body_size`. */
          fileSize: 120 * 1024 * 1024,
        },
        storage: memoryStorage(),
      },
    ),
  )
  create(
    @CurrentUser() user: { id: string },
    @Body() body: CreateGrupoTesteBodyDto,
    @UploadedFiles()
    files: { images?: Express.Multer.File[]; video?: Express.Multer.File[] },
  ) {
    return this.grupoTeste.create(
      user.id,
      {
        description: body.description,
        targetGroupJid: body.targetGroupJid,
      },
      files?.images ?? [],
      files?.video?.[0] ?? null,
    );
  }

  @Post(':id/send')
  send(@Param('id') id: string, @Body() body: SendGrupoTesteDto) {
    return this.grupoTeste.send(id, body.groupJid.trim());
  }
}

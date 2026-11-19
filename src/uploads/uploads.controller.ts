import {
  BadRequestException,
  Controller,
  Logger,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import {
  prepareChannelMediaFromLocalFile,
  type PreparedChannelMedia,
} from './channel-media.util';

@Controller('uploads')
export class UploadsController {
  private readonly logger = new Logger(UploadsController.name);

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = join(process.cwd(), 'uploads');
          mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const unique = Date.now();
          const ext = extname(file.originalname) || '';
          cb(null, `${unique}${ext}`);
        },
      }),
    }),
  )
  upload(@UploadedFile() file: { filename?: string } | undefined) {
    if (!file?.filename) {
      throw new BadRequestException('Ficheiro em falta.');
    }
    const url = `/uploads/${file.filename}`;
    return { url };
  }

  /**
   * Upload para boas-vindas multi-canal: gera variantes WhatsApp + Instagram.
   * Áudio → Ogg Opus (WA) + M4A (IG); imagem WebP → JPEG; PDF partilhado.
   */
  @Post('channel-media')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = join(process.cwd(), 'uploads');
          mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const unique = Date.now();
          const ext = extname(file.originalname) || '';
          cb(null, `${unique}${ext}`);
        },
      }),
      limits: { fileSize: 40 * 1024 * 1024 },
    }),
  )
  async uploadChannelMedia(
    @UploadedFile()
    file:
      | {
          filename?: string;
          path?: string;
          originalname?: string;
          mimetype?: string;
        }
      | undefined,
  ): Promise<PreparedChannelMedia> {
    if (!file?.filename || !file.path) {
      throw new BadRequestException('Ficheiro em falta.');
    }

    try {
      return await prepareChannelMediaFromLocalFile({
        absolutePath: file.path,
        originalName: file.originalname || file.filename,
        mimeType: file.mimetype,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `channel-media: conversão falhou (${file.originalname}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Sem ffmpeg / falha: devolve o original para ambos (envio IG ainda converte áudio).
      const url = `/uploads/${file.filename}`;
      const mime = file.mimetype || 'application/octet-stream';
      return {
        url,
        mediaUrlWhatsapp: url,
        mediaUrlInstagram: url,
        mediaMimeType: mime,
        mediaMimeTypeWhatsapp: mime,
        mediaMimeTypeInstagram: mime,
        mediaFileName: file.originalname || file.filename,
      };
    }
  }
}

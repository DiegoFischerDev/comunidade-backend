import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { mkdirSync } from 'fs';
import { join } from 'path';

@Controller('uploads')
export class UploadsController {
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = join(__dirname, '..', 'uploads');
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
  upload(@UploadedFile() file: any) {
    const url = `/uploads/${file.filename}`;

    return { url };
  }
}


import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { join } from 'path';
import * as express from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';
import { validationExceptionFactory } from './validation-exception.factory';
import { getCorsOrigins } from './config/cors-origins';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  // Endpoints internos de ingest WhatsApp (receiver → backend): mídia em base64 pode ser grande.
  // Configurável via WHATSAPP_SCAN_INGEST_BODY_LIMIT (default: 256mb).
  const whatsappIngestBodyLimit =
    process.env.WHATSAPP_SCAN_INGEST_BODY_LIMIT?.trim() || '256mb';
  const whatsappIngestPaths = new Set([
    '/whatsapp-scan/ingest',
    '/job-offers/whatsapp/ingest',
  ]);
  const jsonDefault = express.json();
  const jsonWhatsappIngest = express.json({ limit: whatsappIngestBodyLimit });
  app.use(
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
      if (req.originalUrl === '/stripe/webhook') {
        express.raw({ type: 'application/json' })(req, res, next);
      } else if (whatsappIngestPaths.has(path)) {
        jsonWhatsappIngest(req, res, next);
      } else {
        jsonDefault(req, res, next);
      }
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.enableCors({
    origin: getCorsOrigins(),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Partner-Device-Id'],
  });
  // Servir arquivos estáticos de uploads
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();

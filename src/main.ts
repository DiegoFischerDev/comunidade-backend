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
  // Webhook Stripe precisa do body em raw para verificar assinatura.
  // O ingest do Whatsapp scan recebe mídia em base64 (Webhook Base64), que pode ser grande
  // (vídeos), por isso usa um limite de JSON maior. Configurável via WHATSAPP_SCAN_INGEST_BODY_LIMIT.
  const scanIngestBodyLimit =
    process.env.WHATSAPP_SCAN_INGEST_BODY_LIMIT?.trim() || '256mb';
  const jsonDefault = express.json();
  const jsonLarge = express.json({ limit: scanIngestBodyLimit });
  app.use(
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (req.originalUrl === '/stripe/webhook') {
        express.raw({ type: 'application/json' })(req, res, next);
      } else if (req.originalUrl === '/whatsapp-scan/ingest') {
        jsonLarge(req, res, next);
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

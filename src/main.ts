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
  // Webhook Stripe precisa do body em raw para verificar assinatura
  app.use((req, res, next) => {
    if (
      req.originalUrl === '/stripe/webhook'
    ) {
      express.raw({ type: 'application/json' })(req, res, next);
    } else {
      express.json()(req, res, next);
    }
  });
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

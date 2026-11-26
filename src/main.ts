import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json } from 'express';
import { AppModule } from './app.module';
import { AppConfig, StorageConfig } from './config/configuration';
import { LOCAL_UPLOAD_DIR } from './media/storage';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  const { port, apiPrefix, corsOrigins, nodeEnv } = config.getOrThrow<AppConfig>('app');

  app.set('trust proxy', 1); // behind nginx; without it every visitor shares one rate-limit bucket
  app.setGlobalPrefix(apiPrefix);
  app.use(json({ limit: '5mb' })); // pages with many blocks are large
  app.use(cookieParser());
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  if (config.getOrThrow<StorageConfig>('storage').driver === 'local') {
    app.useStaticAssets(LOCAL_UPLOAD_DIR, { prefix: '/uploads/', immutable: true, maxAge: '1y' });
  }
  if (nodeEnv !== 'production') {
    const doc = new DocumentBuilder().setTitle('CICC API').addBearerAuth().build();
    SwaggerModule.setup(`${apiPrefix}/docs`, app, SwaggerModule.createDocument(app, doc));
  }
  app.enableShutdownHooks();
  await app.listen(port);
}

bootstrap();

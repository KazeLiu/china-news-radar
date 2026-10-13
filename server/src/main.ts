import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const rootModule = (await import('./app.module')).AppModule;
  const app = await NestFactory.create(rootModule);
  app.enableShutdownHooks();

  app.enableCors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const port = process.env.PORT || 3001;
  await app.listen(port, process.env.HOST || '127.0.0.1');

  console.log(`
  海外涉华快讯服务启动成功
  📡 Server running on http://localhost:${port}
  Mode: ${process.env.RADAR_MODE === 'legacy' ? 'legacy' : 'news'}
  `);
}

bootstrap();

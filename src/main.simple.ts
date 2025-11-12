import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppSimpleModule } from './app.simple.module';

async function bootstrap() {
  const app = await NestFactory.create(AppSimpleModule);

  // Enable CORS
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  });

  // Enable validation (more permissive for simple mode)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      disableErrorMessages: false,
    }),
  );

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('D2D API (Simple Mode)')
    .setDescription('Deploy-to-Deploy: Simple MVP without database')
    .setVersion('1.0-simple')
    .addTag('deployments')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`🚀 D2D Backend (SIMPLE MODE) running on: http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
  console.log(`⚡ No database required - using in-memory storage`);
}

bootstrap();


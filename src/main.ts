import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  const port = process.env.PORT ?? 4000;
  // Listen on 0.0.0.0 so the app is reachable from outside the EC2 instance
  await app.listen(port, '0.0.0.0');
  console.log(`Application running on port ${port}`);
}
bootstrap();

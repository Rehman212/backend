import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Prevent TypeORM connection-retry async rejections from killing the process.
 * PDF/Image tools don't need the DB; the app should keep serving them even when
 * the database is unreachable.
 */
process.on('unhandledRejection', (reason: unknown) => {
  const msg = (reason instanceof Error ? reason.message : String(reason)) ?? '';
  const isDbError =
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('Connection terminated') ||
    msg.includes('connect ETIMEOUT') ||
    msg.includes('connect timeout');

  if (isDbError) {
    console.error('[DB] Connection unavailable — app continues without database.');
    return; // swallow, do NOT re-throw
  }

  // For everything else, keep default behaviour (log + exit)
  console.error('[UnhandledRejection]', reason);
  process.exit(1);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { abortOnError: false });

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  const port = process.env.PORT ?? 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application running on port ${port}`);
}
bootstrap();

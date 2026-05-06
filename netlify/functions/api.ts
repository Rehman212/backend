import { NestFactory } from '@nestjs/core';
import { configure as serverlessExpress } from '@vendia/serverless-express';
import { AppModule } from '../../src/app.module';
import type { Handler } from '@netlify/functions';

let cachedServer: ReturnType<typeof serverlessExpress>;

const bootstrap = async () => {
  const nestApp = await NestFactory.create(AppModule);
  nestApp.enableCors();
  await nestApp.init();
  const expressApp = nestApp.getHttpAdapter().getInstance();
  return serverlessExpress({ app: expressApp });
};

export const handler: Handler = async (event, context) => {
  if (!cachedServer) {
    cachedServer = await bootstrap();
  }
  return cachedServer(event, context) as never;
};

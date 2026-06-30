import {
  Module,
  MiddlewareConsumer,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { ImageModule } from './image/image.module';
import { PdfModule } from './pdf/pdf.module';
import { PdfController } from './pdf/pdf.controller';
import { ImageController } from './image/image.controller';
import { DestroyModule } from './destroy/destroy.module';
import { AdminModule } from './admin/admin.module';
import { PostsModule } from './posts/posts.module';
import { UsersModule } from './users/users.module';
import { ConversionsModule } from './conversions/conversions.module';
import { S3Module } from './s3/s3.module';
import { ConversionTrackingModule } from './middleware/conversion-tracking.module';
import { ConversionTrackingMiddleware } from './middleware/conversion-tracking.middleware';
import { User } from './users/user.entity';
import { ConversionRecord } from './conversions/conversion.entity';
import { BlogPost } from './posts/blog-post.entity';
import { getRequiredConfig } from './config/required-config';

const localEnv = readLocalEnv();
const isDevelopment = getEnvValue('NODE_ENV') === 'development';
const isDatabaseEnabled =
  !isDevelopment ||
  Boolean(
    getEnvValue('DATABASE_URL') ||
      getEnvValue('DB_HOST') ||
      getEnvValue('DB_USERNAME') ||
      getEnvValue('DB_PASSWORD') ||
      getEnvValue('DB_NAME'),
  );

function readLocalEnv(): Record<string, string> {
  const envPath = join(process.cwd(), '.env');

  if (!existsSync(envPath)) {
    return {};
  }

  return readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .reduce<Record<string, string>>((env, line) => {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        return env;
      }

      const separatorIndex = trimmed.indexOf('=');

      if (separatorIndex === -1) {
        return env;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();

      env[key] = value.replace(/^['"]|['"]$/g, '');

      return env;
    }, {});
}

function getEnvValue(key: string): string | undefined {
  return process.env[key] ?? localEnv[key];
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ...(isDatabaseEnabled
      ? [
          TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
              const databaseUrl = config.get<string>('DATABASE_URL');
              const isDevelopment = config.get<string>('NODE_ENV') === 'development';

              return {
                type: 'postgres' as const,
                ...(databaseUrl
                  ? { url: databaseUrl }
                  : {
                      host: isDevelopment
                        ? (config.get<string>('DB_HOST') ?? 'localhost')
                        : getRequiredConfig(config, 'DB_HOST'),
                      port: Number(config.get<string>('DB_PORT') ?? 5432),
                      username: isDevelopment
                        ? (config.get<string>('DB_USERNAME') ?? 'postgres')
                        : getRequiredConfig(config, 'DB_USERNAME'),
                      password: isDevelopment
                        ? (config.get<string>('DB_PASSWORD') ?? 'postgres')
                        : getRequiredConfig(config, 'DB_PASSWORD'),
                      database: config.get<string>('DB_NAME') ?? 'postgres',
                    }),
                entities: [User, ConversionRecord, BlogPost],
                synchronize: true,
                ssl: isDevelopment ? false : { rejectUnauthorized: false },
                retryAttempts: 3, // fail after 3 retries, not 10
                retryDelay: 2000,
                connectTimeoutMS: 5000, // 5 s TCP timeout per attempt
              };
            },
          }),
          AuthModule,
          UsersModule,
          ConversionsModule,
          AdminModule,
          PostsModule,
          ConversionTrackingModule,
        ]
      : []),
    S3Module,
    ImageModule,
    PdfModule,
    DestroyModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    if (isDatabaseEnabled) {
      consumer
        .apply(ConversionTrackingMiddleware)
        .forRoutes(PdfController, ImageController);
    }
  }
}

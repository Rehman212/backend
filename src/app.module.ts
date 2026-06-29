import {
  Module,
  MiddlewareConsumer,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.get<string>('DATABASE_URL');

        return {
          type: 'postgres' as const,
          ...(databaseUrl
            ? { url: databaseUrl }
            : {
                host: config.get<string>('DB_HOST'),
                port: config.get<number>('DB_PORT') ?? 5432,
                username: config.get<string>('DB_USERNAME'),
                password: config.get<string>('DB_PASSWORD'),
                database: config.get<string>('DB_NAME') ?? 'postgres',
              }),
          entities: [User, ConversionRecord, BlogPost],
          synchronize: true,
          ssl:
            config.get<string>('NODE_ENV') === 'development'
              ? false
              : { rejectUnauthorized: false },
          retryAttempts: 3, // fail after 3 retries, not 10
          retryDelay: 2000,
          connectTimeoutMS: 5000, // 5 s TCP timeout per attempt
        };
      },
    }),
    AuthModule,
    UsersModule,
    ConversionsModule,
    S3Module,
    ImageModule,
    PdfModule,
    DestroyModule,
    AdminModule,
    PostsModule,
    ConversionTrackingModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ConversionTrackingMiddleware)
      .forRoutes(PdfController, ImageController);
  }
}

import {
  Module,
  MiddlewareConsumer,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { ImageModule } from './image/image.module';
import { PdfModule } from './pdf/pdf.module';
import { DestroyModule } from './destroy/destroy.module';
import { UsersModule } from './users/users.module';
import { ConversionsModule } from './conversions/conversions.module';
import { S3Module } from './s3/s3.module';
import { ConversionTrackingMiddleware } from './middleware/conversion-tracking.middleware';
import { User } from './users/user.entity';
import { ConversionRecord } from './conversions/conversion.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT') ?? 5432,
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME') ?? 'postgres',
        entities: [User, ConversionRecord],
        synchronize: true,
        ssl: { rejectUnauthorized: false },
        retryAttempts: 3,           // fail after 3 retries, not 10
        retryDelay: 2000,
        connectTimeoutMS: 5000,     // 5 s TCP timeout per attempt
      }),
    }),
    AuthModule,
    UsersModule,
    ConversionsModule,
    S3Module,
    ImageModule,
    PdfModule,
    DestroyModule,
  ],
  controllers: [AppController],
  providers: [ConversionTrackingMiddleware],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ConversionTrackingMiddleware)
      .forRoutes(
        { path: 'pdf/*path', method: RequestMethod.POST },
        { path: 'image/*path', method: RequestMethod.POST },
      );
  }
}

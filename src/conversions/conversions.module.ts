import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversionRecord } from './conversion.entity';
import { ConversionsService } from './conversions.service';
import { ConversionsController } from './conversions.controller';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [TypeOrmModule.forFeature([ConversionRecord]), S3Module],
  providers: [ConversionsService],
  controllers: [ConversionsController],
  exports: [ConversionsService],
})
export class ConversionsModule {}

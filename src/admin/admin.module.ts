import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { ConversionRecord } from '../conversions/conversion.entity';
import { PostsModule } from '../posts/posts.module';
import { S3Module } from '../s3/s3.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, ConversionRecord]), PostsModule, S3Module],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}

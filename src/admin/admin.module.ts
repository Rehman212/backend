import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { ConversionRecord } from '../conversions/conversion.entity';
import { PostsModule } from '../posts/posts.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, ConversionRecord]), PostsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ToolPage } from './tool-page.entity';
import { ToolPagesService } from './tool-pages.service';
import { ToolPagesController } from './tool-pages.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ToolPage])],
  controllers: [ToolPagesController],
  providers: [ToolPagesService],
  exports: [ToolPagesService],
})
export class ToolPagesModule {}

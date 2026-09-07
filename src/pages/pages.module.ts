import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CmsPage } from './cms-page.entity';
import { PagesService } from './pages.service';
import { PagesController } from './pages.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CmsPage])],
  controllers: [PagesController],
  providers: [PagesService],
  exports: [PagesService],
})
export class PagesModule {}

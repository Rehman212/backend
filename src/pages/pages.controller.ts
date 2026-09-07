import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { PagesService } from './pages.service';

/** Public CMS pages — no auth */
@Controller('pages')
export class PagesController {
  constructor(private readonly pagesService: PagesService) {}

  @Get()
  listPublished() {
    return this.pagesService.findPublished();
  }

  @Get(':slug')
  async getBySlug(@Param('slug') slug: string) {
    try {
      return await this.pagesService.findPublishedBySlug(slug);
    } catch {
      throw new NotFoundException('Page not found');
    }
  }
}

import { Controller, Get, Param } from '@nestjs/common';
import { ToolPagesService } from './tool-pages.service';

/** Public tool page content — no auth */
@Controller('tool-pages')
export class ToolPagesController {
  constructor(private readonly toolPagesService: ToolPagesService) {}

  @Get(':slug')
  async getBySlug(@Param('slug') slug: string) {
    const page = await this.toolPagesService.findBySlug(slug);
    if (!page) {
      return {
        slug,
        heroTitle: '',
        heroDescription: '',
        content: '',
        features: [],
        faqs: [],
        createdAt: null,
        updatedAt: null,
      };
    }
    return page;
  }
}

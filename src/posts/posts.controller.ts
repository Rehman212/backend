import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { PostsService } from './posts.service';

/** Public blog routes - no auth required */
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  listPublished() {
    return this.postsService.findPublished();
  }

  @Get(':slug')
  async getBySlug(@Param('slug') slug: string) {
    try {
      return await this.postsService.findPublishedBySlug(slug);
    } catch {
      throw new NotFoundException('Post not found');
    }
  }
}

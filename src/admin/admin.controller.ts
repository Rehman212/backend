import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Query,
  Param,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminService } from './admin.service';
import { PostsService } from '../posts/posts.service';
import { PagesService, type PageDto } from '../pages/pages.service';
import { ToolPagesService } from '../tool-pages/tool-pages.service';
import { S3Service } from '../s3/s3.service';
import { SiteSettingsService } from '../site-settings/site-settings.service';

interface MFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const MAX_FEATURED_IMAGE_BYTES = 100 * 1024; // 100KB

function isWebpFile(file: MFile) {
  const mimeOk = (file.mimetype || '').toLowerCase() === 'image/webp';
  const nameOk = (file.originalname || '').toLowerCase().endsWith('.webp');
  // RIFF....WEBP magic
  const buf = file.buffer;
  const magicOk =
    buf?.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP';
  return mimeOk && nameOk && magicOk;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly postsService: PostsService,
    private readonly pagesService: PagesService,
    private readonly toolPagesService: ToolPagesService,
    private readonly s3Service: S3Service,
    private readonly siteSettings: SiteSettingsService,
  ) {}

  /** Overall site statistics */
  @Get('overview')
  getOverview() {
    return this.adminService.getOverview();
  }

  /** AWS S3 storage breakdown */
  @Get('storage')
  getStorage() {
    return this.adminService.getStorageStats();
  }

  /** Conversion analytics */
  @Get('analytics')
  getAnalytics() {
    return this.adminService.getAnalytics();
  }

  /** Paginated user list */
  @Get('users')
  getUsers(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('role') role?: string,
  ) {
    return this.adminService.getUsers(Number(page), Number(limit), role);
  }

  @Post('users')
  createUser(
    @Body() body: { email: string; username: string; password: string; role?: 'user' | 'admin' },
  ) {
    return this.adminService.createUser(
      body.email,
      body.username,
      body.password,
      body.role ?? 'user',
    );
  }

  @Patch('users/:id/role')
  updateUserRole(
    @Param('id', ParseIntPipe) id: number,
    @Body('role') role: 'user' | 'admin',
    @Request() req: { user: { userId: number } },
  ) {
    return this.adminService.updateUserRole(id, role, req.user.userId);
  }

  @Delete('users/:id')
  deleteUser(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user: { userId: number } },
  ) {
    return this.adminService.deleteUser(id, req.user.userId);
  }

  /** Blog posts */
  @Get('posts')
  getPosts() {
    return this.postsService.findAll();
  }

  /** Upload featured image — WebP only, max 100KB */
  @Post('posts/featured-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FEATURED_IMAGE_BYTES },
    }),
  )
  async uploadFeaturedImage(@UploadedFile() file: MFile) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Image file is required');
    }
    if (file.size > MAX_FEATURED_IMAGE_BYTES) {
      throw new BadRequestException('Featured image must be 100KB or smaller');
    }
    if (!isWebpFile(file)) {
      throw new BadRequestException('Only .webp images are allowed');
    }

    const key = `blog/featured/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
    const url = await this.s3Service.uploadPublic(file.buffer, key, 'image/webp');
    return { url };
  }

  /** Rewrite all blog HTML: long fake H2/H3 body text → <p>, keep real short headings */
  @Post('posts/fix-headings')
  fixPostHeadings() {
    return this.postsService.fixAllHeadingStructure();
  }

  /** General site media (header/footer logos) — PNG/WebP/JPG, max 500KB */
  @Post('media')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 },
    }),
  )
  async uploadMedia(
    @UploadedFile() file: MFile,
    @Body() body: { kind?: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Image file is required');
    }
    if (file.size > 500 * 1024) {
      throw new BadRequestException('File must be 500KB or smaller');
    }

    const mime = (file.mimetype || '').toLowerCase();
    const allowed: Record<string, string> = {
      'image/webp': 'webp',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
    };
    const ext = allowed[mime];
    if (!ext) {
      throw new BadRequestException('Only PNG, WebP, or JPG images are allowed');
    }

    const kind = body?.kind === 'footer' ? 'footer' : body?.kind === 'header' ? 'header' : 'media';
    const key = `site/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const url = await this.s3Service.uploadPublic(file.buffer, key, mime);
    return { url };
  }

  @Get('posts/:id')
  getPost(@Param('id', ParseIntPipe) id: number) {
    return this.postsService.findOne(id);
  }

  @Post('posts')
  createPost(
    @Body() body: {
      title: string;
      slug?: string;
      excerpt?: string;
      content?: string;
      status?: 'draft' | 'published';
      seoTitle?: string;
      seoDescription?: string;
      seoKeywords?: string;
      featuredImage?: string;
      faqs?: { question: string; answer: string }[];
    },
    @Request() req: { user: { username?: string } },
  ) {
    const author = req.user?.username ?? 'Admin';
    return this.postsService.create(body, author);
  }

  @Patch('posts/:id')
  updatePost(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      title?: string;
      slug?: string;
      excerpt?: string;
      content?: string;
      status?: 'draft' | 'published';
      seoTitle?: string;
      seoDescription?: string;
      seoKeywords?: string;
      featuredImage?: string;
      faqs?: { question: string; answer: string }[];
    },
  ) {
    return this.postsService.update(id, body);
  }

  @Delete('posts/:id')
  deletePost(@Param('id', ParseIntPipe) id: number) {
    return this.postsService.remove(id);
  }

  /** CMS pages */
  @Get('pages')
  getPages() {
    return this.pagesService.findAll();
  }

  @Post('pages/import')
  importPages(@Body() body: { pages?: PageDto[] }) {
    return this.pagesService.importMany(body.pages ?? []);
  }

  @Post('pages')
  createPage(@Body() body: PageDto & { title: string }) {
    return this.pagesService.create(body);
  }

  @Get('pages/:id')
  getPage(@Param('id', ParseIntPipe) id: number) {
    return this.pagesService.findOne(id);
  }

  @Patch('pages/:id')
  updatePage(@Param('id', ParseIntPipe) id: number, @Body() body: PageDto) {
    return this.pagesService.update(id, body);
  }

  @Delete('pages/:id')
  deletePage(@Param('id', ParseIntPipe) id: number) {
    return this.pagesService.remove(id);
  }

  /** Per-tool public page content (rich HTML below the tool UI) */
  @Get('tool-pages')
  listToolPages() {
    return this.toolPagesService.list();
  }

  @Get('tool-pages/:slug')
  async getToolPage(@Param('slug') slug: string) {
    const page = await this.toolPagesService.findBySlug(slug);
    return (
      page ?? {
        slug,
        heroTitle: '',
        heroDescription: '',
        content: '',
        features: [],
        faqs: [],
        createdAt: null,
        updatedAt: null,
      }
    );
  }

  @Put('tool-pages/:slug')
  upsertToolPage(
    @Param('slug') slug: string,
    @Body()
    body: {
      heroTitle?: string;
      heroDescription?: string;
      content?: string;
      features?: { title: string; body: string }[];
      faqs?: { question: string; answer: string }[];
    },
  ) {
    return this.toolPagesService.upsert(slug, body);
  }

  @Delete('tool-pages/:slug')
  deleteToolPage(@Param('slug') slug: string) {
    return this.toolPagesService.remove(slug);
  }

  /** Site display settings */
  @Get('site-settings')
  getSiteSettings() {
    return this.siteSettings.get();
  }

  @Patch('site-settings')
  updateSiteSettings(@Body() body: { blogPostsPerPage?: number }) {
    return this.siteSettings.update(body);
  }

  /** Promote a user to admin role by email */
  @Post('promote')
  promote(
    @Body('email') email: string,
    @Request() req: { user: { userId: number } },
  ) {
    return this.adminService.promoteToAdmin(email, req.user.userId);
  }
}

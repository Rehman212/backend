import {
  Controller,
  Get,
  Post,
  Patch,
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
import { S3Service } from '../s3/s3.service';

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
    private readonly s3Service: S3Service,
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
    const url = await this.s3Service.upload(file.buffer, key, 'image/webp');
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
    },
  ) {
    return this.postsService.update(id, body);
  }

  @Delete('posts/:id')
  deletePost(@Param('id', ParseIntPipe) id: number) {
    return this.postsService.remove(id);
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

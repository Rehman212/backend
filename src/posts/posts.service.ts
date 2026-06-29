import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlogPost } from './blog-post.entity';

export type PostDto = {
  title?: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  status?: 'draft' | 'published';
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
};

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function serialize(post: BlogPost) {
  return {
    id: String(post.id),
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt ?? '',
    content: post.content ?? '',
    status: post.status,
    author: post.author,
    seoTitle: post.seoTitle ?? '',
    seoDescription: post.seoDescription ?? '',
    seoKeywords: post.seoKeywords ?? '',
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(BlogPost)
    private readonly postRepo: Repository<BlogPost>,
  ) {}

  async findAll() {
    const posts = await this.postRepo.find({ order: { updatedAt: 'DESC' } });
    return posts.map(serialize);
  }

  async findOne(id: number) {
    const post = await this.postRepo.findOne({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    return serialize(post);
  }

  async create(dto: PostDto, author: string) {
    const title = dto.title?.trim();
    if (!title) throw new BadRequestException('Title is required');

    const slug = dto.slug?.trim() || slugify(title);
    if (!slug) throw new BadRequestException('Slug is required');

    const existing = await this.postRepo.findOne({ where: { slug } });
    if (existing) throw new ConflictException('A post with this slug already exists');

    const post = this.postRepo.create({
      title,
      slug,
      excerpt: dto.excerpt?.trim() ?? '',
      content: dto.content ?? '',
      status: dto.status ?? 'draft',
      author: author || 'Admin',
      seoTitle: dto.seoTitle?.trim() ?? '',
      seoDescription: dto.seoDescription?.trim() ?? '',
      seoKeywords: dto.seoKeywords?.trim() ?? '',
    });

    const saved = await this.postRepo.save(post);
    return serialize(saved);
  }

  async update(id: number, dto: PostDto) {
    const post = await this.postRepo.findOne({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('Title is required');
      post.title = title;
    }

    if (dto.slug !== undefined) {
      const slug = dto.slug.trim() || slugify(post.title);
      if (!slug) throw new BadRequestException('Slug is required');
      if (slug !== post.slug) {
        const existing = await this.postRepo.findOne({ where: { slug } });
        if (existing) throw new ConflictException('A post with this slug already exists');
      }
      post.slug = slug;
    }

    if (dto.excerpt !== undefined) post.excerpt = dto.excerpt;
    if (dto.content !== undefined) post.content = dto.content;
    if (dto.status !== undefined) post.status = dto.status;
    if (dto.seoTitle !== undefined) post.seoTitle = dto.seoTitle.trim();
    if (dto.seoDescription !== undefined) post.seoDescription = dto.seoDescription;
    if (dto.seoKeywords !== undefined) post.seoKeywords = dto.seoKeywords.trim();

    const saved = await this.postRepo.save(post);
    return serialize(saved);
  }

  async remove(id: number) {
    const post = await this.postRepo.findOne({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    await this.postRepo.remove(post);
    return { ok: true };
  }

  async findPublished() {
    const posts = await this.postRepo.find({
      where: { status: 'published' },
      order: { updatedAt: 'DESC' },
    });
    return posts.map(serialize);
  }

  async findPublishedBySlug(slug: string) {
    const post = await this.postRepo.findOne({
      where: { slug, status: 'published' },
    });
    if (!post) throw new NotFoundException('Post not found');
    return serialize(post);
  }
}

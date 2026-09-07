import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CmsPage } from './cms-page.entity';

const RESERVED = new Set([
  'admin',
  'login',
  'signup',
  'dashboard',
  'auth',
  'tool',
  'p',
  'api',
  'blog',
  'favicon.ico',
  'icon.png',
  'logo.webp',
  'robots.txt',
  'sitemap.xml',
]);

export type PageDto = {
  title?: string;
  slug?: string;
  content?: string;
  status?: 'draft' | 'published';
  visibility?: 'public' | 'private';
  parentId?: string | null;
  template?: string;
  order?: number;
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

function serialize(page: CmsPage) {
  return {
    id: String(page.id),
    title: page.title,
    slug: page.slug,
    content: page.content ?? '',
    status: page.status,
    visibility: page.visibility ?? 'public',
    parentId: page.parentId ?? null,
    template: page.template ?? 'default',
    order: page.order ?? 0,
    seoTitle: page.seoTitle ?? '',
    seoDescription: page.seoDescription ?? '',
    seoKeywords: page.seoKeywords ?? '',
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
}

@Injectable()
export class PagesService {
  constructor(
    @InjectRepository(CmsPage)
    private readonly pageRepo: Repository<CmsPage>,
  ) {}

  async findAll() {
    const pages = await this.pageRepo.find({ order: { updatedAt: 'DESC' } });
    return pages.map(serialize);
  }

  async findOne(id: number) {
    const page = await this.pageRepo.findOne({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');
    return serialize(page);
  }

  async findPublished() {
    const pages = await this.pageRepo.find({
      where: { status: 'published', visibility: 'public' },
      order: { order: 'ASC', updatedAt: 'DESC' },
    });
    return pages.map(serialize);
  }

  async findPublishedBySlug(slug: string) {
    const page = await this.pageRepo.findOne({
      where: { slug, status: 'published', visibility: 'public' },
    });
    if (!page) throw new NotFoundException('Page not found');
    return serialize(page);
  }

  async findBySlug(slug: string) {
    const page = await this.pageRepo.findOne({ where: { slug } });
    if (!page) throw new NotFoundException('Page not found');
    return serialize(page);
  }

  async create(dto: PageDto) {
    const title = dto.title?.trim();
    if (!title) throw new BadRequestException('Title is required');

    const slug = (dto.slug?.trim() || slugify(title)).toLowerCase();
    if (!slug) throw new BadRequestException('Slug is required');
    if (RESERVED.has(slug)) throw new BadRequestException('This slug is reserved');

    const existing = await this.pageRepo.findOne({ where: { slug } });
    if (existing) throw new ConflictException('A page with this slug already exists');

    const page = this.pageRepo.create({
      title,
      slug,
      content: dto.content ?? '',
      status: dto.status ?? 'draft',
      visibility: dto.visibility ?? 'public',
      parentId: dto.parentId ?? null,
      template: dto.template ?? 'default',
      order: dto.order ?? 0,
      seoTitle: dto.seoTitle?.trim() ?? '',
      seoDescription: dto.seoDescription ?? '',
      seoKeywords: dto.seoKeywords?.trim() ?? '',
    });
    return serialize(await this.pageRepo.save(page));
  }

  async update(id: number, dto: PageDto) {
    const page = await this.pageRepo.findOne({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('Title is required');
      page.title = title;
    }

    if (dto.slug !== undefined) {
      const slug = (dto.slug.trim() || slugify(page.title)).toLowerCase();
      if (!slug) throw new BadRequestException('Slug is required');
      if (RESERVED.has(slug)) throw new BadRequestException('This slug is reserved');
      if (slug !== page.slug) {
        const existing = await this.pageRepo.findOne({ where: { slug } });
        if (existing) throw new ConflictException('A page with this slug already exists');
      }
      page.slug = slug;
    }

    if (dto.content !== undefined) page.content = dto.content;
    if (dto.status !== undefined) page.status = dto.status;
    if (dto.visibility !== undefined) page.visibility = dto.visibility;
    if (dto.parentId !== undefined) page.parentId = dto.parentId;
    if (dto.template !== undefined) page.template = dto.template;
    if (dto.order !== undefined) page.order = dto.order;
    if (dto.seoTitle !== undefined) page.seoTitle = dto.seoTitle.trim();
    if (dto.seoDescription !== undefined) page.seoDescription = dto.seoDescription;
    if (dto.seoKeywords !== undefined) page.seoKeywords = dto.seoKeywords.trim();

    return serialize(await this.pageRepo.save(page));
  }

  async remove(id: number) {
    const page = await this.pageRepo.findOne({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');
    await this.pageRepo.remove(page);
    return { ok: true };
  }

  /** One-time import of pages that were stored in a browser (localStorage). */
  async importMany(items: PageDto[]) {
    const created: ReturnType<typeof serialize>[] = [];
    for (const item of items) {
      const slug = (item.slug?.trim() || slugify(item.title ?? '')).toLowerCase();
      if (!slug || RESERVED.has(slug)) continue;
      const existing = await this.pageRepo.findOne({ where: { slug } });
      if (existing) {
        created.push(await this.update(existing.id, item));
        continue;
      }
      created.push(await this.create(item));
    }
    return created;
  }
}

import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlogPost } from './blog-post.entity';
import { normalizeBlogContent } from './normalize-blog-content';

export type BlogFaq = { question: string; answer: string };

export type PostDto = {
  title?: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  status?: 'draft' | 'published';
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  featuredImage?: string;
  faqs?: BlogFaq[];
};

const MAX_FAQS = 30;

function normalizeFaqs(raw: unknown): BlogFaq[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = item as { question?: unknown; answer?: unknown };
      return {
        question: typeof row?.question === 'string' ? row.question.trim() : '',
        answer: typeof row?.answer === 'string' ? row.answer.trim() : '',
      };
    })
    .filter((faq) => faq.question && faq.answer)
    .slice(0, MAX_FAQS);
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeSlug(raw: string) {
  return slugify((raw || '').trim().replace(/^\/+|\/+$/g, ''));
}

function excerptFromHtml(html: string, max = 160): string {
  const text = (html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

const MAX_POST_WORDS = 5000;

function countWords(html: string) {
  const text = (html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function assertContentWordLimit(content?: string) {
  if (content === undefined) return;
  const words = countWords(content);
  if (words > MAX_POST_WORDS) {
    throw new BadRequestException(
      `Blog post content cannot exceed ${MAX_POST_WORDS} words (currently ${words}).`,
    );
  }
}

function serialize(post: BlogPost) {
  return {
    id: String(post.id),
    title: post.title,
    slug: normalizeSlug(post.slug),
    excerpt: post.excerpt ?? '',
    content: post.content ?? '',
    status: post.status,
    author: post.author,
    seoTitle: post.seoTitle ?? '',
    seoDescription: post.seoDescription ?? '',
    seoKeywords: post.seoKeywords ?? '',
    featuredImage: post.featuredImage ?? '',
    faqs: normalizeFaqs(post.faqs),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

/** List/card payload — omit heavy HTML bodies so /posts stays crawl-friendly. */
function serializeSummary(post: BlogPost) {
  return {
    id: String(post.id),
    title: post.title,
    slug: normalizeSlug(post.slug),
    excerpt: post.excerpt ?? '',
    content: '',
    status: post.status,
    author: post.author,
    seoTitle: post.seoTitle ?? '',
    seoDescription: post.seoDescription ?? '',
    seoKeywords: post.seoKeywords ?? '',
    featuredImage: post.featuredImage ?? '',
    faqs: [] as BlogFaq[],
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

    const slug = normalizeSlug(dto.slug?.trim() || slugify(title));
    if (!slug) throw new BadRequestException('Slug is required');

    assertContentWordLimit(dto.content);

    const existing = await this.postRepo.findOne({ where: { slug } });
    if (existing) throw new ConflictException('A post with this slug already exists');

    const content = normalizeBlogContent(dto.content ?? '');
    const excerpt = dto.excerpt?.trim() || excerptFromHtml(content);
    const seoDescription = dto.seoDescription?.trim() || excerpt;

    const post = this.postRepo.create({
      title,
      slug,
      excerpt,
      content,
      status: dto.status ?? 'draft',
      author: author || 'Admin',
      seoTitle: dto.seoTitle?.trim() ?? '',
      seoDescription,
      seoKeywords: dto.seoKeywords?.trim() ?? '',
      featuredImage: dto.featuredImage?.trim() ?? '',
      faqs: normalizeFaqs(dto.faqs),
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
      const slug = normalizeSlug(dto.slug.trim() || slugify(post.title));
      if (!slug) throw new BadRequestException('Slug is required');
      if (slug !== post.slug) {
        const existing = await this.postRepo.findOne({ where: { slug } });
        if (existing) throw new ConflictException('A post with this slug already exists');
      }
      post.slug = slug;
    }

    if (dto.excerpt !== undefined) post.excerpt = dto.excerpt.trim();
    if (dto.content !== undefined) {
      assertContentWordLimit(dto.content);
      post.content = normalizeBlogContent(dto.content);
    }
    if (dto.status !== undefined) post.status = dto.status;
    if (dto.seoTitle !== undefined) post.seoTitle = dto.seoTitle.trim();
    if (dto.seoDescription !== undefined) post.seoDescription = dto.seoDescription.trim();
    if (dto.seoKeywords !== undefined) post.seoKeywords = dto.seoKeywords.trim();
    if (dto.featuredImage !== undefined) post.featuredImage = dto.featuredImage.trim();
    if (dto.faqs !== undefined) post.faqs = normalizeFaqs(dto.faqs);

    if (!post.excerpt?.trim()) {
      post.excerpt = excerptFromHtml(post.content);
    }
    if (!post.seoDescription?.trim()) {
      post.seoDescription = post.excerpt?.trim() || excerptFromHtml(post.content);
    }

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
      order: { createdAt: 'DESC' },
      select: [
        'id',
        'title',
        'slug',
        'excerpt',
        'status',
        'author',
        'seoTitle',
        'seoDescription',
        'seoKeywords',
        'featuredImage',
        'createdAt',
        'updatedAt',
      ],
    });
    return posts.map(serializeSummary);
  }

  /** Ultra-light rows for sitemap.xml only. */
  async findPublishedSitemap() {
    const posts = await this.postRepo.find({
      where: { status: 'published' },
      order: { updatedAt: 'DESC' },
      select: ['slug', 'updatedAt', 'createdAt'],
    });
    return posts.map((post) => ({
      slug: normalizeSlug(post.slug),
      updatedAt: post.updatedAt.toISOString(),
      createdAt: post.createdAt.toISOString(),
    }));
  }

  async findPublishedBySlug(slug: string) {
    const clean = normalizeSlug(slug);
    let post = await this.postRepo.findOne({
      where: { slug: clean, status: 'published' },
    });
    if (!post) {
      post = await this.postRepo
        .createQueryBuilder('p')
        .where('p.status = :status', { status: 'published' })
        .andWhere("TRIM(BOTH '/' FROM p.slug) = :clean", { clean })
        .getOne();
    }
    if (!post) throw new NotFoundException('Post not found');
    return serialize(post);
  }

  /** One-shot: rewrite stored HTML so long fake headings become paragraphs. */
  async fixAllHeadingStructure() {
    const posts = await this.postRepo.find();
    let updated = 0;
    const changed: { id: number; slug: string }[] = [];

    for (const post of posts) {
      const next = normalizeBlogContent(post.content ?? '');
      if (next !== (post.content ?? '')) {
        post.content = next;
        await this.postRepo.save(post);
        updated += 1;
        changed.push({ id: post.id, slug: post.slug });
      }
    }

    return { total: posts.length, updated, changed };
  }
}

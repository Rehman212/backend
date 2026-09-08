import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SiteSettings } from './site-settings.entity';

const DEFAULT_PER_PAGE = 9;
const MIN_PER_PAGE = 3;
const MAX_PER_PAGE = 48;

export function clampBlogPostsPerPage(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PER_PAGE;
  return Math.min(MAX_PER_PAGE, Math.max(MIN_PER_PAGE, Math.round(n)));
}

@Injectable()
export class SiteSettingsService {
  constructor(
    @InjectRepository(SiteSettings)
    private readonly repo: Repository<SiteSettings>,
  ) {}

  async get(): Promise<{ blogPostsPerPage: number }> {
    const row = await this.ensureRow();
    return { blogPostsPerPage: clampBlogPostsPerPage(row.blogPostsPerPage) };
  }

  async update(dto: { blogPostsPerPage?: number }) {
    const row = await this.ensureRow();
    if (dto.blogPostsPerPage !== undefined) {
      row.blogPostsPerPage = clampBlogPostsPerPage(dto.blogPostsPerPage);
    }
    const saved = await this.repo.save(row);
    return { blogPostsPerPage: clampBlogPostsPerPage(saved.blogPostsPerPage) };
  }

  private async ensureRow(): Promise<SiteSettings> {
    let row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) {
      row = this.repo.create({ id: 1, blogPostsPerPage: DEFAULT_PER_PAGE });
      row = await this.repo.save(row);
    }
    return row;
  }
}

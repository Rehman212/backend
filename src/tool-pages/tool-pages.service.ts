import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ToolPage } from './tool-page.entity';

export type ToolFaq = { question: string; answer: string };
export type ToolFeature = { title: string; body: string };

export type ToolPageDto = {
  heroTitle?: string;
  heroDescription?: string;
  content?: string;
  features?: ToolFeature[];
  faqs?: ToolFaq[];
};

function normalizeSlug(raw: string) {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .replace(/^tool\//, '');
}

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function serialize(row: ToolPage) {
  return {
    id: String(row.id),
    slug: row.slug,
    heroTitle: row.heroTitle ?? '',
    heroDescription: row.heroDescription ?? '',
    content: row.content ?? '',
    features: parseJsonArray<ToolFeature>(row.featuresJson),
    faqs: parseJsonArray<ToolFaq>(row.faqsJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ToolPagesService {
  constructor(
    @InjectRepository(ToolPage)
    private readonly repo: Repository<ToolPage>,
  ) {}

  async findBySlug(slug: string) {
    const clean = normalizeSlug(slug);
    if (!clean) throw new NotFoundException('Tool page not found');
    const row = await this.repo.findOne({ where: { slug: clean } });
    if (!row) return null;
    return serialize(row);
  }

  async upsert(slug: string, dto: ToolPageDto) {
    const clean = normalizeSlug(slug);
    if (!clean) throw new NotFoundException('Invalid tool slug');

    let row = await this.repo.findOne({ where: { slug: clean } });
    if (!row) {
      row = this.repo.create({
        slug: clean,
        heroTitle: '',
        heroDescription: '',
        content: '',
        featuresJson: '[]',
        faqsJson: '[]',
      });
    }

    if (dto.heroTitle !== undefined) row.heroTitle = dto.heroTitle.trim();
    if (dto.heroDescription !== undefined) row.heroDescription = dto.heroDescription.trim();
    if (dto.content !== undefined) row.content = dto.content ?? '';
    if (dto.features !== undefined) {
      row.featuresJson = JSON.stringify(
        (dto.features || [])
          .map((f) => ({
            title: String(f?.title ?? '').trim(),
            body: String(f?.body ?? '').trim(),
          }))
          .filter((f) => f.title || f.body),
      );
    }
    if (dto.faqs !== undefined) {
      row.faqsJson = JSON.stringify(
        (dto.faqs || [])
          .map((f) => ({
            question: String(f?.question ?? '').trim(),
            answer: String(f?.answer ?? '').trim(),
          }))
          .filter((f) => f.question && f.answer),
      );
    }

    const saved = await this.repo.save(row);
    return serialize(saved);
  }

  async remove(slug: string) {
    const clean = normalizeSlug(slug);
    const row = await this.repo.findOne({ where: { slug: clean } });
    if (!row) return { ok: true, slug: clean, deleted: false };
    await this.repo.remove(row);
    return { ok: true, slug: clean, deleted: true };
  }

  async list() {
    const rows = await this.repo.find({ order: { updatedAt: 'DESC' } });
    return rows.map(serialize);
  }
}

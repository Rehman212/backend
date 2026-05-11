import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversionRecord } from './conversion.entity';

@Injectable()
export class ConversionsService {
  constructor(
    @InjectRepository(ConversionRecord)
    private readonly repo: Repository<ConversionRecord>,
  ) {}

  save(data: {
    userId: number;
    toolSlug: string;
    originalFileName: string;
    outputFileName: string;
    s3Key: string;
    s3Url: string;
    fileSize: number;
  }): Promise<ConversionRecord> {
    const record = this.repo.create(data);
    return this.repo.save(record);
  }

  findByUser(userId: number): Promise<ConversionRecord[]> {
    return this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async deleteById(id: number, userId: number): Promise<void> {
    await this.repo.delete({ id, userId });
  }
}

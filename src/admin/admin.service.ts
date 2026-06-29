import { Injectable, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import {
  S3Client,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { User } from '../users/user.entity';
import { ConversionRecord } from '../conversions/conversion.entity';

@Injectable()
export class AdminService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ConversionRecord)
    private readonly convRepo: Repository<ConversionRecord>,
    private readonly config: ConfigService,
  ) {
    this.region = config.get<string>('AWS_REGION')!;
    this.bucket = config.get<string>('AWS_BUCKET_NAME')!;
    this.s3 = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY')!,
      },
    });
  }

  /* ── Overview stats ── */
  async getOverview() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekStart  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const dayStart   = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalUsers,
      totalConversions,
      newUsersMonth,
      newUsersWeek,
      newConversionsToday,
      newConversionsWeek,
      newConversionsMonth,
      storageSumRaw,
    ] = await Promise.all([
      this.userRepo.count(),
      this.convRepo.count(),
      this.userRepo.createQueryBuilder('u').where('u.createdAt >= :d', { d: monthStart }).getCount(),
      this.userRepo.createQueryBuilder('u').where('u.createdAt >= :d', { d: weekStart }).getCount(),
      this.convRepo.createQueryBuilder('c').where('c.createdAt >= :d', { d: dayStart }).getCount(),
      this.convRepo.createQueryBuilder('c').where('c.createdAt >= :d', { d: weekStart }).getCount(),
      this.convRepo.createQueryBuilder('c').where('c.createdAt >= :d', { d: monthStart }).getCount(),
      this.convRepo
        .createQueryBuilder('c')
        .select('SUM(c.fileSize)', 'total')
        .getRawOne<{ total: string }>(),
    ]);

    return {
      totalUsers,
      totalConversions,
      newUsersMonth,
      newUsersWeek,
      newConversionsToday,
      newConversionsWeek,
      newConversionsMonth,
      totalStorageBytes: Number(storageSumRaw?.total ?? 0),
    };
  }

  /* ── S3 storage monitoring ── */
  async getStorageStats() {
    let objectCount = 0;
    let totalBytes  = 0;
    let continuationToken: string | undefined;

    // Paginate through S3 objects (max 5 pages = 5000 objects)
    for (let page = 0; page < 5; page++) {
      const res = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        }),
      );
      objectCount += res.KeyCount ?? 0;
      for (const obj of res.Contents ?? []) {
        totalBytes += obj.Size ?? 0;
      }
      if (!res.IsTruncated) break;
      continuationToken = res.NextContinuationToken;
    }

    // DB storage breakdown by tool
    const byTool = await this.convRepo
      .createQueryBuilder('c')
      .select('c.toolSlug', 'tool')
      .addSelect('COUNT(c.id)', 'count')
      .addSelect('SUM(c.fileSize)', 'bytes')
      .groupBy('c.toolSlug')
      .orderBy('bytes', 'DESC')
      .limit(20)
      .getRawMany<{ tool: string; count: string; bytes: string }>();

    // Recent large files
    const recentFiles = await this.convRepo
      .createQueryBuilder('c')
      .select(['c.id', 'c.toolSlug', 'c.outputFileName', 'c.fileSize', 'c.createdAt'])
      .orderBy('c.fileSize', 'DESC')
      .limit(10)
      .getMany();

    return {
      s3: {
        bucket: this.bucket,
        region: this.region,
        objectCount,
        totalBytes,
      },
      byTool: byTool.map((r) => ({
        tool:  r.tool,
        count: Number(r.count),
        bytes: Number(r.bytes),
      })),
      recentFiles,
    };
  }

  /* ── Analytics ── */
  async getAnalytics() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [topTools, dailyRaw, recentUsers] = await Promise.all([
      this.convRepo
        .createQueryBuilder('c')
        .select('c.toolSlug', 'tool')
        .addSelect('COUNT(c.id)', 'count')
        .groupBy('c.toolSlug')
        .orderBy('count', 'DESC')
        .limit(15)
        .getRawMany<{ tool: string; count: string }>(),

      this.convRepo
        .createQueryBuilder('c')
        .select("DATE_TRUNC('day', c.createdAt)", 'day')
        .addSelect('COUNT(c.id)', 'count')
        .where('c.createdAt >= :d', { d: thirtyDaysAgo })
        .groupBy("DATE_TRUNC('day', c.createdAt)")
        .orderBy("DATE_TRUNC('day', c.createdAt)", 'ASC')
        .getRawMany<{ day: string; count: string }>(),

      this.userRepo
        .createQueryBuilder('u')
        .select(['u.id', 'u.email', 'u.username', 'u.role', 'u.createdAt'])
        .orderBy('u.createdAt', 'DESC')
        .limit(10)
        .getMany(),
    ]);

    return {
      topTools: topTools.map((r) => ({ tool: r.tool, count: Number(r.count) })),
      dailyConversions: dailyRaw.map((r) => ({ day: r.day, count: Number(r.count) })),
      recentUsers,
    };
  }

  /* ── All users ── */
  async getUsers(page = 1, limit = 20) {
    const [users, total] = await this.userRepo.findAndCount({
      select: ['id', 'email', 'username', 'role', 'createdAt'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { users, total, page, limit };
  }

  async createUser(email: string, username: string, plainPassword: string) {
    const existing = await this.userRepo.findOne({
      where: [{ email: email.trim() }, { username: username.trim() }],
    });
    if (existing) {
      if (existing.email === email.trim()) {
        throw new ConflictException('Email already in use');
      }
      throw new ConflictException('Username already in use');
    }
    const password = await bcrypt.hash(plainPassword, 10);
    const user = this.userRepo.create({
      email: email.trim(),
      username: username.trim(),
      password,
      role: 'admin',
    });
    const saved = await this.userRepo.save(user);
    return {
      id: saved.id,
      email: saved.email,
      username: saved.username,
      role: saved.role,
      createdAt: saved.createdAt,
    };
  }

  async deleteUser(id: number, requesterId: number) {
    if (id === requesterId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    await this.userRepo.remove(user);
    return { success: true, message: 'User removed' };
  }

  /* ── Promote user to admin ── */
  async promoteToAdmin(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) return { success: false, message: 'User not found' };
    user.role = 'admin';
    await this.userRepo.save(user);
    return { success: true, message: `${email} is now an admin` };
  }
}

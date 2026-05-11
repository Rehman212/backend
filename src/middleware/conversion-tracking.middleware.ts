import { Injectable, NestMiddleware, Optional } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConversionsService } from '../conversions/conversions.service';
import { S3Service } from '../s3/s3.service';

@Injectable()
export class ConversionTrackingMiddleware implements NestMiddleware {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    // @Optional() so the middleware still loads when DB is unreachable
    @Optional() private readonly conversionsService: ConversionsService | null,
    @Optional() private readonly s3Service: S3Service | null,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Only track if request carries a Bearer token AND DB services are available
    const authHeader = req.headers['authorization'] as string | undefined;
    if (!authHeader?.startsWith('Bearer ') || !this.conversionsService || !this.s3Service) {
      return next();
    }

    // Patch res.send to capture the buffer before it leaves the process
    const originalSend = res.send.bind(res);
    (res as any).send = (body: any): Response => {
      const contentDisposition = res.getHeader('content-disposition') as string;
      const contentType = (res.getHeader('content-type') as string | undefined) ?? 'application/octet-stream';

      if (Buffer.isBuffer(body) && contentDisposition?.includes('attachment')) {
        this.trackInBackground(req, body, contentDisposition, contentType).catch(() => {});
      }

      return originalSend(body);
    };

    next();
  }

  private async trackInBackground(
    req: Request,
    buffer: Buffer,
    contentDisposition: string,
    contentType: string,
  ): Promise<void> {
    try {
      const token = (req.headers['authorization'] as string).replace('Bearer ', '');
      const payload = this.jwtService.verify(token, {
        secret: this.config.get<string>('ACCESS_TOKEN_SECRET'),
      });
      const userId: number = Number(payload.sub);

      // Extract tool slug from URL path: /api/pdf/merge-pdf → merge-pdf
      const segments = req.path.replace(/^\//, '').split('/').filter(Boolean);
      const toolSlug = segments[segments.length - 1] ?? 'unknown';

      // Extract output filename from Content-Disposition header
      const nameMatch = contentDisposition.match(/filename="?([^";\n]+)"?/);
      const outputFileName = nameMatch?.[1]?.trim() ?? `${toolSlug}-output`;

      // S3 key: conversions/{userId}/{timestamp}-{filename}
      const s3Key = `conversions/${userId}/${Date.now()}-${outputFileName}`;

      const s3Url = await this.s3Service!.upload(buffer, s3Key, contentType);

      await this.conversionsService!.save({
        userId,
        toolSlug,
        originalFileName: '',
        outputFileName,
        s3Key,
        s3Url,
        fileSize: buffer.length,
      });
    } catch {
      // Silent fail — never affect the user's download
    }
  }
}

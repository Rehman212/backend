import {
  Controller,
  Get,
  Delete,
  Param,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { ConversionsService } from './conversions.service';
import { S3Service } from '../s3/s3.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('conversions')
@UseGuards(JwtAuthGuard)
export class ConversionsController {
  constructor(
    private readonly conversionsService: ConversionsService,
    private readonly s3Service: S3Service,
  ) {}

  @Get()
  async getMyConversions(@Request() req: any) {
    const records = await this.conversionsService.findByUser(req.user.userId);
    return Promise.all(
      records.map(async (r) => ({
        id: r.id,
        toolSlug: r.toolSlug,
        originalFileName: r.originalFileName,
        outputFileName: r.outputFileName,
        fileSize: Number(r.fileSize),
        createdAt: r.createdAt,
        downloadUrl: r.s3Key ? await this.s3Service.getPresignedUrl(r.s3Key) : null,
      })),
    );
  }

  @Delete(':id')
  async deleteConversion(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    await this.conversionsService.deleteById(id, req.user.userId);
    return { success: true };
  }
}

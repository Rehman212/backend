import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ImageService, ImageResult } from './image.service';

/** Local interface avoids TS1272 with isolatedModules + emitDecoratorMetadata */
interface MFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('image')
export class ImageController {
  constructor(private readonly svc: ImageService) {}

  /* ── helper: sends binary image response ──────────────────────────────── */
  private reply(res: Response, result: ImageResult, filename: string): void {
    res.set({
      'Content-Type': result.mime,
      'Content-Disposition': `attachment; filename="${filename}.${result.ext}"`,
      'Content-Length': String(result.buffer.length),
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
    res.status(HttpStatus.OK).send(result.buffer);
  }

  /* ── error helper ─────────────────────────────────────────────────────── */
  private err(res: Response, status: number, msg: string): void {
    res.status(status).json({ statusCode: status, message: msg });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     I.  DIGITAL IMAGE CONVERSIONS
  ═══════════════════════════════════════════════════════════════════════ */

  @Post('jpg-jpeg-update')
  @UseInterceptors(FileInterceptor('file'))
  async jpgJpegUpdate(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.jpgJpegUpdate(
        file.buffer,
        body.output_extension ?? 'jpg',
      );
      this.reply(res, result, 'updated');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('jpg-to-png')
  @UseInterceptors(FileInterceptor('file'))
  async jpgToPng(
    @UploadedFile() file: MFile,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      this.reply(res, await this.svc.jpgToPng(file.buffer), 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('png-to-jpg')
  @UseInterceptors(FileInterceptor('file'))
  async pngToJpg(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.pngToJpg(
        file.buffer,
        body.background_color ?? '#ffffff',
        parseInt(body.quality ?? '90', 10),
      );
      this.reply(res, result, 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /** HTML to Image — requires Puppeteer on the server.
   *  Returns 501 with guidance when not available. */
  @Post('html-to-image')
  @UseInterceptors(FileInterceptor('file'))
  async htmlToImage(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    const hasFile = !!file;
    const hasUrl  = !!body.url?.trim();
    if (!hasFile && !hasUrl)
      return this.err(res, 400, 'Provide either an HTML file or a URL.');

    try {
      const format  = (['png', 'jpeg', 'webp'].includes(body.format) ? body.format : 'png') as 'png' | 'jpeg' | 'webp';
      const width   = Math.max(1, parseInt(body.width  ?? '1280') || 1280);
      const height  = body.height ? Math.max(1, parseInt(body.height) || 768) : undefined;
      const quality = Math.min(100, Math.max(1, parseInt(body.quality ?? '90') || 90));

      const result = await this.svc.htmlToImage({
        html:    hasFile ? file.buffer.toString('utf-8') : undefined,
        url:     hasUrl  ? body.url.trim()               : undefined,
        format, width, height, quality,
      });
      this.reply(res, result, 'screenshot');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('convert')
  @UseInterceptors(FileInterceptor('file'))
  async convertFormat(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.convertFormat(
        file.buffer,
        body.output_format ?? 'png',
      );
      this.reply(res, result, 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     II-A.  SIZING & DIMENSIONS
  ═══════════════════════════════════════════════════════════════════════ */

  @Post('compress')
  @UseInterceptors(FileInterceptor('file'))
  async compress(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.compress(
        file.buffer,
        parseInt(body.quality ?? '75', 10),
        body.output_format ?? 'jpg',
      );
      this.reply(res, result, 'compressed');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('resize')
  @UseInterceptors(FileInterceptor('file'))
  async resize(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.resize(
        file.buffer,
        parseInt(body.width  ?? '800', 10),
        parseInt(body.height ?? '600', 10),
        body.fit ?? 'cover',
      );
      this.reply(res, result, 'resized');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('crop')
  @UseInterceptors(FileInterceptor('file'))
  async crop(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.crop(
        file.buffer,
        parseInt(body.x      ?? '0',   10),
        parseInt(body.y      ?? '0',   10),
        parseInt(body.width  ?? '800', 10),
        parseInt(body.height ?? '600', 10),
      );
      this.reply(res, result, 'cropped');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     II-B.  ENHANCEMENTS
  ═══════════════════════════════════════════════════════════════════════ */

  @Post('ai-upscale')
  @UseInterceptors(FileInterceptor('file'))
  async aiUpscale(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.aiUpscale(
        file.buffer,
        parseInt(body.scale ?? '2', 10),
      );
      this.reply(res, result, 'upscaled');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('unblur')
  @UseInterceptors(FileInterceptor('file'))
  async unblur(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.unblur(
        file.buffer,
        parseFloat(body.strength ?? '5'),
      );
      this.reply(res, result, 'sharpened');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     II-C.  VISUAL EFFECTS
  ═══════════════════════════════════════════════════════════════════════ */

  @Post('blur')
  @UseInterceptors(FileInterceptor('file'))
  async blur(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.blur(
        file.buffer,
        parseFloat(body.radius ?? '10'),
      );
      this.reply(res, result, 'blurred');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('rotate')
  @UseInterceptors(FileInterceptor('file'))
  async rotate(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.rotate(
        file.buffer,
        body.angle ?? '90',
        parseFloat(body.custom_angle ?? '45'),
        body.background ?? '#ffffff',
      );
      this.reply(res, result, 'rotated');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('tilt-flip')
  @UseInterceptors(FileInterceptor('file'))
  async tiltFlip(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.tiltFlip(
        file.buffer,
        body.flip ?? 'horizontal',
        parseFloat(body.tilt ?? '0'),
        body.background ?? '#ffffff',
      );
      this.reply(res, result, 'flipped');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     II-D.  CONTENT EDITING
  ═══════════════════════════════════════════════════════════════════════ */

  /** Remove Background — requires an AI service (e.g. remove.bg API key). */
  @Post('remove-background')
  @UseInterceptors(FileInterceptor('file'))
  async removeBackground(
    @UploadedFile() file: MFile,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.removeBackground(file.buffer);
      this.reply(res, result, 'bg-removed');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('watermark')
  @UseInterceptors(FileInterceptor('file'))
  async watermark(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.addWatermark(
        file.buffer,
        body.text        ?? '© Watermark',
        body.position    ?? 'bottom-right',
        parseInt(body.font_size ?? '24', 10),
        parseInt(body.opacity   ?? '60', 10),
        body.color       ?? '#ffffff',
        parseFloat(body.rotation ?? '0'),
      );
      this.reply(res, result, 'watermarked');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('meme')
  @UseInterceptors(FileInterceptor('file'))
  async meme(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.memeGenerator(
        file.buffer,
        body.top_text     ?? '',
        body.bottom_text  ?? '',
        parseInt(body.font_size    ?? '36', 10),
        body.text_color   ?? '#ffffff',
        body.stroke_color ?? '#000000',
      );
      this.reply(res, result, 'meme');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('photo-editor')
  @UseInterceptors(FileInterceptor('file'))
  async photoEditor(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.photoEditor(
        file.buffer,
        parseFloat(body.brightness ?? '0'),
        parseFloat(body.contrast   ?? '0'),
        parseFloat(body.saturation ?? '0'),
        parseFloat(body.hue        ?? '0'),
        parseFloat(body.sharpness  ?? '0'),
        body.filter ?? 'none',
      );
      this.reply(res, result, 'edited');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }
}

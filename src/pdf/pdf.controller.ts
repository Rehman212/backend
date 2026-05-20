import {
  Controller,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  Body,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { PdfService, PdfResult } from './pdf.service';

/** Local Multer file interface — avoids TS1272 with isolatedModules + emitDecoratorMetadata */
interface MFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('pdf')
export class PdfController {
  constructor(private readonly svc: PdfService) {}

  /* ── helpers ──────────────────────────────────────────────────────────── */
  private reply(res: Response, r: PdfResult, filename: string): void {
    res.set({
      'Content-Type': r.mime,
      'Content-Disposition': `attachment; filename="${filename}.${r.ext}"`,
      'Content-Length': String(r.buffer.length),
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
    res.status(HttpStatus.OK).send(r.buffer);
  }

  private err(res: Response, status: number, msg: string): void {
    res.status(status).json({ statusCode: status, message: msg });
  }

  private notImplemented(res: Response, hint: string): void {
    this.err(res, 501, `Not implemented on this server. ${hint}`);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ORGANIZE
  ═══════════════════════════════════════════════════════════════════════ */

  @Post('merge')
  @UseInterceptors(FilesInterceptor('files'))
  async merge(@UploadedFiles() files: MFile[], @Res() res: Response) {
    if (!files?.length) return this.err(res, 400, 'No files uploaded.');
    try {
      const result = await this.svc.merge(files.map(f => f.buffer));
      this.reply(res, result, 'merged');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('split')
  @UseInterceptors(FileInterceptor('file'))
  async split(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.split(
        file.buffer,
        body.split_mode   ?? 'ranges',
        body.ranges       ?? '1-999',
        parseInt(body.fixed_range ?? '1', 10),
      );
      this.reply(res, result, 'split');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('selective-merge')
  @UseInterceptors(FilesInterceptor('files'))
  async selectiveMerge(
    @UploadedFiles() files: MFile[],
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!files?.length) return this.err(res, 400, 'No files uploaded.');
    try {
      const result = await this.svc.selectiveMerge(files.map(f => f.buffer), body.page_ranges ?? '');
      this.reply(res, result, 'merged');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('split-by-size')
  @UseInterceptors(FileInterceptor('file'))
  async splitBySize(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.splitBySize(file.buffer, parseFloat(body.max_size_mb ?? '5'));
      this.reply(res, result, 'split');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('split-by-bookmark')
  @UseInterceptors(FileInterceptor('file'))
  async splitByBookmark(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.splitByBookmark(file.buffer, body.bookmark_level ?? '1');
      this.reply(res, result, 'split');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('delete-pages')
  @UseInterceptors(FileInterceptor('file'))
  async deletePages(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.deletePages(file.buffer, body.pages ?? '');
      this.reply(res, result, 'output');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('rotate-pages')
  @UseInterceptors(FileInterceptor('file'))
  async rotatePages(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.rotatePages(
        file.buffer,
        body.pages ?? 'all',
        parseInt(body.rotation ?? '90', 10),
      );
      this.reply(res, result, 'rotated');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('reorder-pages')
  @UseInterceptors(FileInterceptor('file'))
  async reorderPages(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.reorderPages(file.buffer, body.order ?? '');
      this.reply(res, result, 'reordered');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('extract-pages')
  @UseInterceptors(FileInterceptor('file'))
  async extractPageRange(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.extractPageRange(file.buffer, body.pages ?? '1-999');
      this.reply(res, result, 'extracted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('reverse-pages')
  @UseInterceptors(FileInterceptor('file'))
  async reversePages(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.reversePages(file.buffer);
      this.reply(res, result, 'reversed');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     OPTIMIZE
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
      const result = await this.svc.compress(file.buffer, body.compression_level ?? 'recommended');
      this.reply(res, result, 'compressed');
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
      const result = await this.svc.rotate(file.buffer, parseInt(body.rotation ?? '90', 10));
      this.reply(res, result, 'rotated');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('repair')
  @UseInterceptors(FileInterceptor('file'))
  async repair(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      this.reply(res, await this.svc.repair(file.buffer), 'repaired');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONVERT TO PDF
  ═══════════════════════════════════════════════════════════════════════ */

  @Post('office-to-pdf')
  @UseInterceptors(FileInterceptor('file'))
  async officeToPdf(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const ext    = (file.originalname ?? '').split('.').pop()?.toLowerCase() ?? '';
      const result = await this.svc.officeToPdf(file.buffer, ext);
      this.reply(res, result, 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('image-to-pdf')
  @UseInterceptors(FilesInterceptor('files'))
  async imageToPdf(@UploadedFiles() files: MFile[], @Res() res: Response) {
    if (!files?.length) return this.err(res, 400, 'No files uploaded.');
    try {
      const result = await this.svc.imageToPdf(
        files.map(f => f.buffer),
        files.map(f => f.mimetype),
      );
      this.reply(res, result, 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('html-to-pdf')
  @UseInterceptors(FileInterceptor('file'))
  async htmlToPdf(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.htmlToPdf(file.buffer);
      this.reply(res, result, 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('epub-to-pdf')
  @UseInterceptors(FileInterceptor('file'))
  async epubToPdf(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.epubToPdf(file.buffer);
      this.reply(res, result, 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('cad-to-pdf')
  @UseInterceptors(FileInterceptor('file'))
  async cadToPdf(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const ext    = (file.originalname ?? '').split('.').pop()?.toLowerCase() ?? '';
      const result = await this.svc.cadToPdf(file.buffer, ext);
      this.reply(res, result, 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONVERT FROM PDF
  ═══════════════════════════════════════════════════════════════════════ */

  @Post('pdf-to-image')
  @UseInterceptors(FileInterceptor('file'))
  async pdfToImage(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.pdfToImage(
        file.buffer,
        (body.format ?? 'jpg').toLowerCase(),
        parseInt(body.dpi ?? '150', 10),
      );
      this.reply(res, result, 'images');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('extract')
  @UseInterceptors(FileInterceptor('file'))
  async extract(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.extractPages(file.buffer, body.mode ?? 'pages');
      this.reply(res, result, 'extracted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('pdf-to-text')
  @UseInterceptors(FileInterceptor('file'))
  async pdfToText(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      this.reply(res, await this.svc.pdfToText(file.buffer), 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('pdf-to-epub')
  @UseInterceptors(FileInterceptor('file'))
  async pdfToEpub(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const title = (file.originalname || 'document').replace(/\.pdf$/i, '');
      const result = await this.svc.pdfToEpub(file.buffer, title);
      this.reply(res, result, 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('pdf-to-html')
  @UseInterceptors(FileInterceptor('file'))
  async pdfToHtml(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const title = (file.originalname || 'document').replace(/\.pdf$/i, '');
      const result = await this.svc.pdfToHtml(file.buffer, title);
      this.reply(res, result, 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('pdf-to-csv')
  @UseInterceptors(FileInterceptor('file'))
  async pdfToCsv(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.pdfToCsv(file.buffer);
      this.reply(res, result, 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('pdf-to-xml')
  @UseInterceptors(FileInterceptor('file'))
  async pdfToXml(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const title = (file.originalname || 'document').replace(/\.pdf$/i, '');
      const result = await this.svc.pdfToXml(file.buffer, title);
      this.reply(res, result, 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('pdf-to-word')
  @UseInterceptors(FileInterceptor('file'))
  async pdfToWord(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const title = (file.originalname || 'document').replace(/\.pdf$/i, '');
      const result = await this.svc.pdfToWord(file.buffer, title);
      this.reply(res, result, 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('pdf-to-excel')
  @UseInterceptors(FileInterceptor('file'))
  async pdfToExcel(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const title = (file.originalname || 'document').replace(/\.pdf$/i, '');
      const result = await this.svc.pdfToExcel(file.buffer, title);
      this.reply(res, result, 'converted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONTENT EDITING
  ═══════════════════════════════════════════════════════════════════════ */

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
        body.text               ?? 'CONFIDENTIAL',
        body.vertical_position  ?? 'middle',
        body.horizontal_position ?? 'center',
        parseInt(body.font_size    ?? '40',  10),
        parseInt(body.transparency ?? '50',  10),
        parseInt(body.rotation     ?? '315', 10),
        body.font_color ?? '#FF0000',
      );
      this.reply(res, result, 'watermarked');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('page-numbers')
  @UseInterceptors(FileInterceptor('file'))
  async pageNumbers(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.addPageNumbers(
        file.buffer,
        parseInt(body.starting_number     ?? '1',       10),
        body.vertical_position             ?? 'bottom',
        body.horizontal_position           ?? 'center',
        parseInt(body.font_size            ?? '12',      10),
        body.font_color                    ?? '#000000',
      );
      this.reply(res, result, 'numbered');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('ocr')
  @UseInterceptors(FileInterceptor('file'))
  async ocr(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const lang   = body.lang ?? 'eng';
      const result = await this.svc.ocrFile(file.buffer, file.mimetype, lang);
      this.reply(res, result, 'ocr');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('add-text-box')
  @UseInterceptors(FileInterceptor('file'))
  async addTextBox(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.addTextBox(
        file.buffer,
        body.text       ?? 'Your text here',
        body.pages      ?? '1',
        parseFloat(body.x          ?? '100'),
        parseFloat(body.y          ?? '100'),
        parseInt(body.font_size    ?? '14',  10),
        body.font_color ?? '#000000',
        parseFloat(body.opacity    ?? '100'),
        parseFloat(body.rotation   ?? '0'),
      );
      this.reply(res, result, 'edited');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('sticky-note')
  @UseInterceptors(FileInterceptor('file'))
  async stickyNote(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.stickyNote(
        file.buffer,
        body.text ?? 'Note here',
        parseInt(body.pages ?? '1', 10),
        parseFloat(body.x   ?? '100'),
        parseFloat(body.y   ?? '100'),
      );
      this.reply(res, result, 'annotated');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('highlight')
  @UseInterceptors(FileInterceptor('file'))
  async highlight(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.highlight(
        file.buffer,
        parseInt(body.pages  ?? '1',   10),
        parseFloat(body.x    ?? '100'),
        parseFloat(body.y    ?? '100'),
        parseFloat(body.width  ?? '200'),
        parseFloat(body.height ?? '20'),
        body.color ?? '#FFFF00',
      );
      this.reply(res, result, 'highlighted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('underline')
  @UseInterceptors(FileInterceptor('file'))
  async underline(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.underline(
        file.buffer,
        parseInt(body.pages  ?? '1',   10),
        parseFloat(body.x    ?? '100'),
        parseFloat(body.y    ?? '100'),
        parseFloat(body.width  ?? '200'),
        parseFloat(body.height ?? '20'),
      );
      this.reply(res, result, 'underlined');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('strikeout')
  @UseInterceptors(FileInterceptor('file'))
  async strikeout(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.strikeout(
        file.buffer,
        parseInt(body.pages  ?? '1',   10),
        parseFloat(body.x    ?? '100'),
        parseFloat(body.y    ?? '100'),
        parseFloat(body.width  ?? '200'),
        parseFloat(body.height ?? '20'),
      );
      this.reply(res, result, 'strikeout');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('image-watermark')
  @UseInterceptors(FileInterceptor('file'))
  async imageWatermark(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.imageWatermark(
        file.buffer,
        body.image_url ?? '',
        body.gravity   ?? 'Center',
        parseInt(body.opacity  ?? '50',  10),
        parseInt(body.scale    ?? '50',  10),
        parseFloat(body.rotation ?? '0'),
        body.pages ?? 'all',
      );
      this.reply(res, result, 'watermarked');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('bates-numbering')
  @UseInterceptors(FileInterceptor('file'))
  async batesNumbering(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.batesNumbering(
        file.buffer,
        body.prefix            ?? 'DOC-',
        body.suffix            ?? '',
        parseInt(body.starting_number     ?? '1',       10),
        body.vertical_position             ?? 'bottom',
        body.horizontal_position           ?? 'right',
        parseInt(body.font_size            ?? '12',      10),
        body.font_color                    ?? '#000000',
      );
      this.reply(res, result, 'bates');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('edit-text')
  @UseInterceptors(FileInterceptor('file'))
  async editText(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.editText(
        file.buffer,
        body.new_text ?? '',
        parseInt(body.page ?? '1', 10),
        parseFloat(body.x ?? '100'),
        parseFloat(body.y ?? '100'),
        parseFloat(body.cover_width ?? '200'),
        parseFloat(body.cover_height ?? '20'),
        parseFloat(body.font_size ?? '12'),
        body.font_color ?? '#000000',
        body.cover_color ?? '#ffffff',
      );
      this.reply(res, result, 'edited');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SECURITY
  ═══════════════════════════════════════════════════════════════════════ */

  @Post('protect')
  @UseInterceptors(FileInterceptor('file'))
  async protect(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    if (!body.password) return this.err(res, 400, 'password is required in the request body.');
    try {
      const result = await this.svc.protect(file.buffer, body.password, body.owner_password);
      this.reply(res, result, 'protected');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('unlock')
  @UseInterceptors(FileInterceptor('file'))
  async unlock(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      this.reply(res, await this.svc.unlock(file.buffer), 'unlocked');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('set-permissions')
  @UseInterceptors(FileInterceptor('file'))
  async setPermissions(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    if (!body.owner_password) return this.err(res, 400, 'owner_password is required.');
    try {
      const result = await this.svc.setPermissions(file.buffer, body.owner_password, {
        printing:    body.printing    !== 'false',
        modifying:   body.modifying   === 'true',
        copying:     body.copying     === 'true',
        annotating:  body.annotating  === 'true',
        fillingForms: body.filling_forms === 'true',
      });
      this.reply(res, result, 'permissions-set');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('redact')
  @UseInterceptors(FileInterceptor('file'))
  async redact(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.redact(
        file.buffer,
        parseInt(body.page ?? '1', 10),
        parseFloat(body.x ?? '100'),
        parseFloat(body.y ?? '100'),
        parseFloat(body.width ?? '200'),
        parseFloat(body.height ?? '20'),
        body.color ?? '#000000',
      );
      this.reply(res, result, 'redacted');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('stamp')
  @UseInterceptors(FileInterceptor('file'))
  async addStamp(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.addStamp(
        file.buffer,
        body.text ?? 'APPROVED',
        body.position ?? 'center',
        body.pages ?? 'all',
        parseFloat(body.font_size ?? '48'),
        body.color ?? '#ff0000',
        parseFloat(body.opacity ?? '40'),
        parseFloat(body.rotation ?? '330'),
      );
      this.reply(res, result, 'stamped');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('digital-id')
  @UseInterceptors(FileInterceptor('file'))
  async digitalId(
    @UploadedFile() _file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    // Accept either 'name' or 'common_name'; fall back to email
    const commonName = body.name || body.common_name || body.email;
    if (!commonName) return this.err(res, 400, 'name is required.');
    // Auto-generate password if not provided
    const password = body.password || Math.random().toString(36).slice(2, 10);
    try {
      const result = await this.svc.createDigitalId({
        commonName,
        organization: body.organization,
        email:        body.email,
        country:      body.country,
        password,
        validYears:   body.valid_years ? parseInt(body.valid_years) : 3,
      });
      this.reply(res, result, 'digital-id');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('validate-signature')
  @UseInterceptors(FileInterceptor('file'))
  async validateSignature(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.validateSignature(file.buffer);
      this.reply(res, result, 'validation-report');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     STANDARDS
  ═══════════════════════════════════════════════════════════════════════ */

  @Post('pdf-to-pdfa')
  @UseInterceptors(FileInterceptor('file'))
  async pdfToPdfa(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const conformance = (['A', 'B', 'U'].includes(body.conformance?.toUpperCase())
        ? body.conformance.toUpperCase()
        : 'B') as 'A' | 'B' | 'U';
      const result = await this.svc.pdfToPdfa(file.buffer, conformance);
      this.reply(res, result, 'pdfa');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('validate-pdfa')
  @UseInterceptors(FileInterceptor('file'))
  async validatePdfa(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.validatePdfa(file.buffer);
      res.status(HttpStatus.OK).json(result);
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('pdf-to-pdfx')
  @UseInterceptors(FileInterceptor('file'))
  async pdfToPdfx(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const version = (['1a', '3', '4'].includes(body.version)
        ? body.version : '3') as '1a' | '3' | '4';
      const result = await this.svc.pdfToPdfx(file.buffer, version);
      this.reply(res, result, 'pdfx');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('pdf-to-pdfe')
  @UseInterceptors(FileInterceptor('file'))
  async pdfToPdfe(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.pdfToPdfe(file.buffer);
      this.reply(res, result, 'pdfe');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('pdf-to-pdfua')
  @UseInterceptors(FileInterceptor('file'))
  async pdfToPdfua(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.pdfToPdfua(
        file.buffer,
        body.title ?? '',
        body.lang  ?? 'en-US',
      );
      this.reply(res, result, 'converted_pdfua');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     INTERACTIVE FORMS
  ═══════════════════════════════════════════════════════════════════════ */

  @Post('create-form')
  @UseInterceptors(FileInterceptor('file'))
  async createForm(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.createForm(file.buffer, body.fields ?? '[]');
      this.reply(res, result, 'form');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('fill-form')
  @UseInterceptors(FileInterceptor('file'))
  async fillForm(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.fillForm(
        file.buffer,
        body.data    ?? '{}',
        body.flatten === 'true',
      );
      this.reply(res, result, 'filled');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('export-form-data')
  @UseInterceptors(FileInterceptor('file'))
  async exportFormData(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const fmt = (body.format ?? 'json').toLowerCase();
      const result = await this.svc.exportFormData(file.buffer, fmt);
      res
        .status(HttpStatus.OK)
        .setHeader('Content-Type', result.mime)
        .setHeader('Content-Disposition', `attachment; filename="form-data.${result.ext}"`)
        .send(result.buffer);
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('validate-form')
  @UseInterceptors(FileInterceptor('file'))
  async validateForm(@UploadedFile() file: MFile, @Res() res: Response) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.validateForm(file.buffer);
      res.status(HttpStatus.OK).json(result);
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('form-field-management')
  @UseInterceptors(FileInterceptor('file'))
  async formFieldManagement(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const action = body.action ?? 'list';
      if (action === 'list') {
        const result = await this.svc.listFormFields(file.buffer);
        return res.status(HttpStatus.OK).json(result);
      }
      const result = await this.svc.manageFormField(
        file.buffer,
        action,
        body.field_name     ?? '',
        body.new_field_name ?? '',
      );
      if (result.mime === 'application/json') {
        return res.status(HttpStatus.OK).json(JSON.parse(result.buffer.toString()));
      }
      this.reply(res, result, 'managed');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PDF TO POWERPOINT
  ═══════════════════════════════════════════════════════════════════════ */
  @Post('pdf-to-pptx')
  @UseInterceptors(FileInterceptor('file'))
  async pdfToPptx(
    @UploadedFile() file: MFile,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.pdfToPptx(file.buffer);
      this.reply(res, result, 'presentation');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     TRANSLATE PDF
  ═══════════════════════════════════════════════════════════════════════ */
  @Post('translate-pdf')
  @UseInterceptors(FileInterceptor('file'))
  async translatePdf(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.translatePdf(file.buffer, body.target_lang ?? 'es');
      this.reply(res, result, 'translated');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ORGANIZE PDF  (alias for reorder-pages — same service method)
  ═══════════════════════════════════════════════════════════════════════ */
  @Post('organize-pdf')
  @UseInterceptors(FileInterceptor('file'))
  async organizePdf(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const result = await this.svc.reorderPages(file.buffer, body.pages ?? '');
      this.reply(res, result, 'organized');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }

  @Post('remove-watermark')
  @UseInterceptors(FileInterceptor('file'))
  async removePdfWatermark(
    @UploadedFile() file: MFile,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!file) return this.err(res, 400, 'No file uploaded.');
    try {
      const strength = parseInt(body.strength ?? '60', 10);
      const result   = await this.svc.removePdfWatermark(file.buffer, strength);
      this.reply(res, result, 'cleaned');
    } catch (e) {
      this.err(res, 500, (e as Error).message);
    }
  }
}

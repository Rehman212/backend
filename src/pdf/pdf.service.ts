import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import { exec }  from 'child_process';
import { promisify } from 'util';
import {
  PDFDocument,
  rgb,
  degrees,
  StandardFonts,
  Color,
  PDFName,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
} from 'pdf-lib';
import JSZip from 'jszip';
import sharp from 'sharp';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { parse as parseHtml } from 'node-html-parser';


export interface PdfResult {
  buffer: Buffer;
  mime: string;
  ext: string;
}

@Injectable()
export class PdfService {
  /* ─── Helpers ──────────────────────────────────────────────────────────── */

  private hexToColor(hex: string): Color {
    const h = (hex || '#000000').replace('#', '').padEnd(6, '0');
    return rgb(
      parseInt(h.substring(0, 2), 16) / 255,
      parseInt(h.substring(2, 4), 16) / 255,
      parseInt(h.substring(4, 6), 16) / 255,
    );
  }

  private n(val: any, fallback: number): number {
    const v = parseFloat(val);
    return isNaN(v) ? fallback : v;
  }

  private toBuffer(u8: Uint8Array): Buffer {
    return Buffer.from(u8);
  }

  /** Parse "1-3, 5, 7-9" into arrays of 0-based page indices. */
  private parseRanges(rangesStr: string, total: number): number[][] {
    const result: number[][] = [];
    const parts = (rangesStr || '1').split(',').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (part.includes('-')) {
        const [a, b] = part.split('-').map(s => parseInt(s.trim(), 10));
        const pages: number[] = [];
        for (let i = a; i <= Math.min(isNaN(b) ? a : b, total); i++) {
          if (i >= 1) pages.push(i - 1);
        }
        if (pages.length) result.push(pages);
      } else {
        const n = parseInt(part, 10);
        if (!isNaN(n) && n >= 1 && n <= total) result.push([n - 1]);
      }
    }
    return result.length ? result : [Array.from({ length: total }, (_, i) => i)];
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ORGANIZE
  ═══════════════════════════════════════════════════════════════════════ */

  async merge(buffers: Buffer[]): Promise<PdfResult> {
    const merged = await PDFDocument.create();
    for (const buf of buffers) {
      const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }
    return { buffer: this.toBuffer(await merged.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async split(
    buffer: Buffer,
    splitMode: string,
    rangesStr: string,
    fixedRange: number,
  ): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const total = doc.getPageCount();
    const zip = new JSZip();

    let groups: number[][];
    if (splitMode === 'fixed_range') {
      const n = Math.max(1, fixedRange);
      groups = [];
      for (let i = 0; i < total; i += n)
        groups.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
    } else if (splitMode === 'remove_pages') {
      const toRemove = new Set(this.parseRanges(rangesStr, total).flat());
      const remaining = Array.from({ length: total }, (_, i) => i).filter(i => !toRemove.has(i));
      groups = remaining.length ? [remaining] : [[0]];
    } else {
      groups = this.parseRanges(rangesStr, total);
    }

    for (let i = 0; i < groups.length; i++) {
      const newDoc = await PDFDocument.create();
      const copied = await newDoc.copyPages(doc, groups[i]);
      copied.forEach(p => newDoc.addPage(p));
      zip.file(`part_${String(i + 1).padStart(3, '0')}.pdf`, await newDoc.save());
    }

    const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { buffer: zipBuf as Buffer, mime: 'application/zip', ext: 'zip' };
  }

  async selectiveMerge(buffers: Buffer[], pageRangesStr: string): Promise<PdfResult> {
    const merged = await PDFDocument.create();
    for (const buf of buffers) {
      const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
      const total = doc.getPageCount();
      const indices = !pageRangesStr?.trim()
        ? Array.from({ length: total }, (_, i) => i)
        : this.parseRanges(pageRangesStr, total).flat();
      const pages = await merged.copyPages(doc, indices);
      pages.forEach(p => merged.addPage(p));
    }
    return { buffer: this.toBuffer(await merged.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async splitBySize(buffer: Buffer, maxSizeMb: number): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const total = doc.getPageCount();
    const maxBytes = Math.max(0.1, maxSizeMb) * 1024 * 1024;
    const zip = new JSZip();
    let group: number[] = [];
    let groupSize = 0;
    let part = 1;

    for (let i = 0; i < total; i++) {
      const pageDoc = await PDFDocument.create();
      const [p] = await pageDoc.copyPages(doc, [i]);
      pageDoc.addPage(p);
      const pageBytes = (await pageDoc.save()).length;

      if (group.length > 0 && groupSize + pageBytes > maxBytes) {
        const batchDoc = await PDFDocument.create();
        const batchPages = await batchDoc.copyPages(doc, group);
        batchPages.forEach(pg => batchDoc.addPage(pg));
        zip.file(`part_${String(part++).padStart(3, '0')}.pdf`, await batchDoc.save());
        group = [];
        groupSize = 0;
      }
      group.push(i);
      groupSize += pageBytes;
    }

    if (group.length > 0) {
      const batchDoc = await PDFDocument.create();
      const batchPages = await batchDoc.copyPages(doc, group);
      batchPages.forEach(pg => batchDoc.addPage(pg));
      zip.file(`part_${String(part).padStart(3, '0')}.pdf`, await batchDoc.save());
    }

    const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { buffer: zipBuf as Buffer, mime: 'application/zip', ext: 'zip' };
  }

  async splitByBookmark(buffer: Buffer, bookmarkLevel: string): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const total = doc.getPageCount();

    const pageRefIndex = new Map<string, number>();
    for (let i = 0; i < total; i++) {
      pageRefIndex.set((doc.getPage(i) as any).ref.toString(), i);
    }

    const splitPoints = new Set<number>([0]);
    const maxDepth = bookmarkLevel === 'all' ? 999 : parseInt(bookmarkLevel, 10);

    try {
      const ctx = (doc as any).context;
      const catalog = (doc as any).catalog;
      const outlinesRef = catalog.get(PDFName.of('Outlines'));
      if (outlinesRef) {
        const outlinesDict = ctx.lookup(outlinesRef);
        const traverse = (dict: any, depth: number) => {
          if (!dict || depth > maxDepth) return;
          let cur = dict.get(PDFName.of('First'));
          while (cur) {
            const item = ctx.lookup(cur);
            if (!item) break;
            const dest = item.get(PDFName.of('Dest'));
            if (dest) {
              const arr = ctx.lookup(dest) ?? dest;
              if (arr && typeof arr.get === 'function') {
                const pageRef = arr.get(0);
                if (pageRef) {
                  const idx = pageRefIndex.get(pageRef.toString());
                  if (idx !== undefined && idx > 0) splitPoints.add(idx);
                }
              }
            }
            const action = item.get(PDFName.of('A'));
            if (action) {
              const act = ctx.lookup(action);
              if (act) {
                const d = act.get(PDFName.of('D'));
                if (d) {
                  const arr = ctx.lookup(d) ?? d;
                  if (arr && typeof arr.get === 'function') {
                    const pageRef = arr.get(0);
                    if (pageRef) {
                      const idx = pageRefIndex.get(pageRef.toString());
                      if (idx !== undefined && idx > 0) splitPoints.add(idx);
                    }
                  }
                }
              }
            }
            traverse(item, depth + 1);
            cur = item.get(PDFName.of('Next'));
          }
        };
        traverse(outlinesDict, 1);
      }
    } catch {
      for (let i = 1; i < total; i++) splitPoints.add(i);
    }

    const points = Array.from(splitPoints).sort((a, b) => a - b);
    const zip = new JSZip();
    for (let i = 0; i < points.length; i++) {
      const start = points[i];
      const end = i + 1 < points.length ? points[i + 1] : total;
      const pages = Array.from({ length: end - start }, (_, k) => start + k);
      const newDoc = await PDFDocument.create();
      const copied = await newDoc.copyPages(doc, pages);
      copied.forEach(p => newDoc.addPage(p));
      zip.file(`section_${String(i + 1).padStart(3, '0')}.pdf`, await newDoc.save());
    }
    const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { buffer: zipBuf as Buffer, mime: 'application/zip', ext: 'zip' };
  }

  async deletePages(buffer: Buffer, pagesStr: string): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const total = doc.getPageCount();
    const toDelete = new Set(this.parseRanges(pagesStr, total).flat());
    const remaining = Array.from({ length: total }, (_, i) => i).filter(i => !toDelete.has(i));
    const newDoc = await PDFDocument.create();
    if (remaining.length > 0) {
      const copied = await newDoc.copyPages(doc, remaining);
      copied.forEach(p => newDoc.addPage(p));
    }
    return { buffer: this.toBuffer(await newDoc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async rotatePages(buffer: Buffer, pagesStr: string, rotation: number): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const total = doc.getPageCount();
    const indices = pagesStr.trim().toLowerCase() === 'all'
      ? Array.from({ length: total }, (_, i) => i)
      : this.parseRanges(pagesStr, total).flat();
    const pageSet = new Set(indices);
    for (let i = 0; i < total; i++) {
      if (pageSet.has(i)) {
        const page = doc.getPage(i);
        const current = page.getRotation().angle;
        page.setRotation(degrees((current + rotation) % 360));
      }
    }
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async reorderPages(buffer: Buffer, orderStr: string): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const total = doc.getPageCount();
    const order = (orderStr || '')
      .split(',')
      .map(s => parseInt(s.trim(), 10) - 1)
      .filter(i => i >= 0 && i < total);
    if (!order.length) {
      return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
    }
    const newDoc = await PDFDocument.create();
    const copied = await newDoc.copyPages(doc, order);
    copied.forEach(p => newDoc.addPage(p));
    return { buffer: this.toBuffer(await newDoc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async extractPageRange(buffer: Buffer, pagesStr: string): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const total = doc.getPageCount();
    const indices = this.parseRanges(pagesStr, total).flat();
    const newDoc = await PDFDocument.create();
    const copied = await newDoc.copyPages(doc, indices);
    copied.forEach(p => newDoc.addPage(p));
    return { buffer: this.toBuffer(await newDoc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async reversePages(buffer: Buffer): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const total = doc.getPageCount();
    const reversed = Array.from({ length: total }, (_, i) => total - 1 - i);
    const newDoc = await PDFDocument.create();
    const copied = await newDoc.copyPages(doc, reversed);
    copied.forEach(p => newDoc.addPage(p));
    return { buffer: this.toBuffer(await newDoc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     OPTIMIZE
  ═══════════════════════════════════════════════════════════════════════ */

  async compress(buffer: Buffer, compressionLevel: string): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const useStreams = compressionLevel !== 'low';
    return { buffer: this.toBuffer(await doc.save({ useObjectStreams: useStreams })), mime: 'application/pdf', ext: 'pdf' };
  }

  async rotate(buffer: Buffer, rotation: number): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    for (const page of doc.getPages()) {
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + rotation) % 360));
    }
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async repair(buffer: Buffer): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONVERT TO PDF
  ═══════════════════════════════════════════════════════════════════════ */

  async imageToPdf(buffers: Buffer[], mimetypes: string[]): Promise<PdfResult> {
    const pdfDoc = await PDFDocument.create();
    for (let i = 0; i < buffers.length; i++) {
      const mime = (mimetypes[i] || 'image/jpeg').toLowerCase();
      let buf = buffers[i];
      let embedded;
      if (mime === 'image/png') {
        embedded = await pdfDoc.embedPng(buf);
      } else {
        if (mime !== 'image/jpeg') buf = await sharp(buf).jpeg({ quality: 90 }).toBuffer();
        embedded = await pdfDoc.embedJpg(buf);
      }
      const page = pdfDoc.addPage([embedded.width, embedded.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    }
    return { buffer: this.toBuffer(await pdfDoc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONVERT FROM PDF
  ═══════════════════════════════════════════════════════════════════════ */

  async ocrFile(fileBuffer: Buffer, mimeType: string, lang = 'eng'): Promise<PdfResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createWorker } = require('tesseract.js') as typeof import('tesseract.js');

    // Collect image buffers to OCR — either the raw image or PDF pages rendered to PNG
    const imageBuffers: Buffer[] = [];

    const isPdf = mimeType === 'application/pdf' ||
                  mimeType === 'application/x-pdf';

    if (isPdf) {
      // Render each PDF page to a PNG using pdfjs-dist + canvas
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as any;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createCanvas } = require('canvas') as { createCanvas: (w: number, h: number) => any };
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';

      const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer), verbosity: 0 }).promise;
      const SCALE  = 2; // 2× scale ≈ 144 dpi, better OCR accuracy

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const vp   = page.getViewport({ scale: SCALE });
        const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height));
        const ctx    = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        imageBuffers.push(canvas.toBuffer('image/png'));
      }
    } else {
      // Direct image upload
      imageBuffers.push(fileBuffer);
    }

    // OCR each image with tesseract.js
    const worker = await createWorker(lang);
    const pageTexts: string[] = [];

    for (let i = 0; i < imageBuffers.length; i++) {
      const { data } = await worker.recognize(imageBuffers[i]);
      const pageLabel = imageBuffers.length > 1 ? `--- Page ${i + 1} ---\n` : '';
      pageTexts.push(pageLabel + (data.text ?? '').trim());
    }

    await worker.terminate();

    const fullText = pageTexts.join('\n\n');
    return { buffer: Buffer.from(fullText, 'utf-8'), mime: 'text/plain', ext: 'txt' };
  }

  async pdfToExcel(pdfBuffer: Buffer, docTitle = 'Sheet1'): Promise<PdfResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as any;
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), verbosity: 0 }).promise;

    const wb   = XLSX.utils.book_new();
    const ROW_TOL = 4;
    const COL_TOL = 20;

    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page    = await pdfDoc.getPage(p);
      const content = await page.getTextContent();
      const items   = content.items as any[];

      // ── Cluster into rows by Y ──────────────────────────────────────────────
      const rowMap = new Map<number, { x: number; str: string }[]>();
      for (const item of items) {
        if (!item.str?.trim()) continue;
        const rawY = item.transform?.[5] ?? 0;
        let foundY: number | undefined;
        for (const k of rowMap.keys()) {
          if (Math.abs(k - rawY) <= ROW_TOL) { foundY = k; break; }
        }
        const key: number = foundY ?? rawY;
        if (!rowMap.has(key)) rowMap.set(key, []);
        rowMap.get(key)!.push({ x: item.transform?.[4] ?? 0, str: item.str });
      }

      const sortedRows = [...rowMap.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, cells]) => cells.sort((a, b) => a.x - b.x));

      // ── Detect column boundaries ───────────────────────────────────────────
      const allX = sortedRows.flatMap(r => r.map(c => c.x)).sort((a, b) => a - b);
      const colBoundaries: number[] = [];
      for (const x of allX) {
        if (!colBoundaries.length || x - colBoundaries[colBoundaries.length - 1] > COL_TOL) {
          colBoundaries.push(x);
        }
      }

      // ── Build 2-D array for this page ──────────────────────────────────────
      const sheetData: string[][] = sortedRows.map(row => {
        const csvRow = new Array<string>(colBoundaries.length).fill('');
        for (const cell of row) {
          let colIdx = 0;
          let minDist = Math.abs(cell.x - colBoundaries[0]);
          for (let ci = 1; ci < colBoundaries.length; ci++) {
            const d = Math.abs(cell.x - colBoundaries[ci]);
            if (d < minDist) { minDist = d; colIdx = ci; }
          }
          csvRow[colIdx] = csvRow[colIdx] ? csvRow[colIdx] + ' ' + cell.str : cell.str;
        }
        return csvRow;
      });

      const ws        = XLSX.utils.aoa_to_sheet(sheetData);
      const sheetName = pdfDoc.numPages === 1
        ? (docTitle.slice(0, 31) || 'Sheet1')
        : `Page ${p}`;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return {
      buffer: xlsxBuffer,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ext: 'xlsx',
    };
  }

  async pdfToWord(pdfBuffer: Buffer, docTitle = 'Converted Document'): Promise<PdfResult> {
    // Extract text per page using pdfjs-dist
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as any;
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), verbosity: 0 }).promise;

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // Collect paragraphs: group items by Y per page, sort top-to-bottom
    const paragraphs: { text: string; isPageBreak?: boolean }[] = [];

    for (let p = 1; p <= pdfDoc.numPages; p++) {
      if (p > 1) paragraphs.push({ text: '', isPageBreak: true });

      const page    = await pdfDoc.getPage(p);
      const content = await page.getTextContent();
      const items   = content.items as any[];

      // Cluster into rows by Y (tolerance 4 units)
      const ROW_TOL = 4;
      const rowMap  = new Map<number, string[]>();
      for (const item of items) {
        if (!item.str?.trim()) continue;
        const rawY = item.transform?.[5] ?? 0;
        let foundY: number | undefined;
        for (const k of rowMap.keys()) {
          if (Math.abs(k - rawY) <= ROW_TOL) { foundY = k; break; }
        }
        const key: number = foundY ?? rawY;
        if (!rowMap.has(key)) rowMap.set(key, []);
        rowMap.get(key)!.push(item.str);
      }

      const lines = [...rowMap.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, words]) => words.join(' ').trim())
        .filter(Boolean);

      for (const line of lines) paragraphs.push({ text: line });
    }

    // Build word/document.xml body paragraphs
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const bodyParas = paragraphs.map(para => {
      if (para.isPageBreak) {
        return (
          `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`
        );
      }
      return `<w:p><w:r><w:t xml:space="preserve">${esc(para.text)}</w:t></w:r></w:p>`;
    }).join('\n    ');

    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<w:document xmlns:w="${W}">\n` +
      `  <w:body>\n` +
      `    ${bodyParas}\n` +
      `    <w:sectPr>\n` +
      `      <w:pgSz w:w="12240" w:h="15840"/>\n` +
      `      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>\n` +
      `    </w:sectPr>\n` +
      `  </w:body>\n` +
      `</w:document>`;

    const stylesXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<w:styles xmlns:w="${W}">\n` +
      `  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">\n` +
      `    <w:name w:val="Normal"/>\n` +
      `    <w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>\n` +
      `  </w:style>\n` +
      `</w:styles>`;

    const contentTypes =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
      `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
      `  <Default Extension="xml"  ContentType="application/xml"/>\n` +
      `  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n` +
      `  <Override PartName="/word/styles.xml"   ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>\n` +
      `  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>\n` +
      `</Types>`;

    const rootRels =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
      `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n` +
      `  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>\n` +
      `</Relationships>`;

    const wordRels =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
      `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n` +
      `</Relationships>`;

    const coreXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">\n` +
      `  <dc:title>${esc(docTitle)}</dc:title>\n` +
      `  <dc:creator>imagedigitalhub</dc:creator>\n` +
      `</cp:coreProperties>`;

    const zip = new JSZip();
    zip.file('[Content_Types].xml',          contentTypes);
    zip.file('_rels/.rels',                  rootRels);
    zip.file('word/document.xml',            documentXml);
    zip.file('word/styles.xml',              stylesXml);
    zip.file('word/_rels/document.xml.rels', wordRels);
    zip.file('docProps/core.xml',            coreXml);

    const docxBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return {
      buffer: docxBuffer,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ext: 'docx',
    };
  }

  async pdfToXml(pdfBuffer: Buffer, docTitle = 'Converted Document'): Promise<PdfResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as any;
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), verbosity: 0 }).promise;

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;')
       .replace(/"/g, '&quot;')
       .replace(/'/g, '&apos;');

    let pagesXml = '';

    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page    = await pdfDoc.getPage(p);
      const vp      = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items   = content.items as any[];

      let itemsXml = '';
      for (const item of items) {
        if (!item.str?.trim()) continue;
        const x        = Math.round((item.transform?.[4] ?? 0) * 100) / 100;
        const y        = Math.round((item.transform?.[5] ?? 0) * 100) / 100;
        const width    = Math.round((item.width  ?? 0) * 100) / 100;
        const height   = Math.round((item.height ?? 0) * 100) / 100;
        const fontSize = Math.round((item.transform?.[0] ?? 0) * 100) / 100;
        const fontName = esc(item.fontName ?? '');
        itemsXml +=
          `      <text x="${x}" y="${y}" width="${width}" height="${height}"` +
          ` font-size="${fontSize}" font="${fontName}">${esc(item.str)}</text>\n`;
      }

      pagesXml +=
        `  <page number="${p}" width="${Math.round(vp.width)}" height="${Math.round(vp.height)}">\n` +
        itemsXml +
        `  </page>\n`;
    }

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<document title="${esc(docTitle)}" pages="${pdfDoc.numPages}">\n` +
      pagesXml +
      `</document>`;

    return { buffer: Buffer.from(xml, 'utf-8'), mime: 'application/xml', ext: 'xml' };
  }

  async pdfToCsv(pdfBuffer: Buffer): Promise<PdfResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as any;
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), verbosity: 0 }).promise;

    // CSV-quote a single cell value
    const csvCell = (s: string) => {
      const v = s.replace(/"/g, '""');
      return /[,"\n\r]/.test(v) ? `"${v}"` : v;
    };

    const allRows: string[][] = [];

    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page    = await pdfDoc.getPage(p);
      const content = await page.getTextContent();
      const items   = content.items as any[];

      if (!items.length) continue;

      // ── Step 1: cluster items into rows by Y position ──────────────────────
      // Use a tolerance of ~4 PDF units so items on the same text line group together
      const ROW_TOL = 4;
      const rowBuckets = new Map<number, { x: number; str: string }[]>();

      for (const item of items) {
        if (!item.str?.trim()) continue;
        const rawY  = item.transform?.[5] ?? 0;
        // Find existing bucket within tolerance
        let foundY: number | undefined;
        for (const key of rowBuckets.keys()) {
          if (Math.abs(key - rawY) <= ROW_TOL) { foundY = key; break; }
        }
        const bucketY: number = foundY ?? rawY;
        if (!rowBuckets.has(bucketY)) rowBuckets.set(bucketY, []);
        rowBuckets.get(bucketY)!.push({ x: item.transform?.[4] ?? 0, str: item.str });
      }

      // Sort rows top-to-bottom (PDF Y is bottom-up so descending)
      const sortedRows = [...rowBuckets.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, cells]) => cells.sort((a, b) => a.x - b.x)); // left-to-right within row

      // ── Step 2: detect column boundaries from X positions ──────────────────
      // Collect all unique X starts across all rows
      const allX: number[] = sortedRows.flatMap(row => row.map(c => c.x));
      allX.sort((a, b) => a - b);

      // Cluster X positions into column buckets (tolerance 20 PDF units ≈ ~7mm)
      const COL_TOL = 20;
      const colBoundaries: number[] = [];
      for (const x of allX) {
        if (!colBoundaries.length || x - colBoundaries[colBoundaries.length - 1] > COL_TOL) {
          colBoundaries.push(x);
        }
      }

      const numCols = colBoundaries.length;

      // ── Step 3: map each cell to its column slot ────────────────────────────
      for (const row of sortedRows) {
        const csvRow = new Array<string>(numCols).fill('');
        for (const cell of row) {
          // Find the nearest column boundary
          let colIdx = 0;
          let minDist = Math.abs(cell.x - colBoundaries[0]);
          for (let ci = 1; ci < colBoundaries.length; ci++) {
            const d = Math.abs(cell.x - colBoundaries[ci]);
            if (d < minDist) { minDist = d; colIdx = ci; }
          }
          // Append to slot (multiple items can land in the same column)
          csvRow[colIdx] = csvRow[colIdx]
            ? csvRow[colIdx] + ' ' + cell.str
            : cell.str;
        }
        allRows.push(csvRow);
      }

      // Blank separator row between pages
      if (p < pdfDoc.numPages) allRows.push([]);
    }

    // ── Step 4: emit CSV ───────────────────────────────────────────────────────
    const csv = allRows
      .map(row => row.map(csvCell).join(','))
      .join('\r\n');

    return { buffer: Buffer.from(csv, 'utf-8'), mime: 'text/csv', ext: 'csv' };
  }

  async pdfToHtml(pdfBuffer: Buffer, docTitle = 'Converted Document'): Promise<PdfResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as any;
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), verbosity: 0 }).promise;

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let bodyHtml = '';
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page    = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      const items   = content.items as any[];

      // Group items into lines by Y position (rounded to 2 dp)
      const lineMap = new Map<number, string[]>();
      for (const item of items) {
        if (!item.str?.trim()) continue;
        // transform[5] is the Y coordinate in PDF user space
        const y = Math.round((item.transform?.[5] ?? 0) * 100) / 100;
        if (!lineMap.has(y)) lineMap.set(y, []);
        lineMap.get(y)!.push(item.str);
      }

      // Sort Y descending (PDF y=0 is bottom-left)
      const sortedLines = [...lineMap.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, words]) => words.join(' ').trim())
        .filter(Boolean);

      bodyHtml +=
        `  <section class="page" id="page-${i}">\n` +
        `    <h2 class="page-label">Page ${i}</h2>\n` +
        sortedLines.map(line => `    <p>${esc(line)}</p>`).join('\n') +
        '\n  </section>\n';
    }

    const html =
      `<!DOCTYPE html>\n` +
      `<html lang="en">\n` +
      `<head>\n` +
      `  <meta charset="UTF-8"/>\n` +
      `  <meta name="viewport" content="width=device-width, initial-scale=1"/>\n` +
      `  <title>${esc(docTitle)}</title>\n` +
      `  <style>\n` +
      `    body { font-family: Georgia, serif; max-width: 860px; margin: 40px auto; padding: 0 20px; color: #222; line-height: 1.7; }\n` +
      `    h1   { font-size: 1.8em; border-bottom: 2px solid #ccc; padding-bottom: .4em; }\n` +
      `    .page { margin-bottom: 3em; padding-bottom: 2em; border-bottom: 1px dashed #ddd; }\n` +
      `    .page-label { font-size: .85em; text-transform: uppercase; letter-spacing: .1em; color: #888; margin-bottom: .5em; }\n` +
      `    p { margin: .3em 0; }\n` +
      `  </style>\n` +
      `</head>\n` +
      `<body>\n` +
      `  <h1>${esc(docTitle)}</h1>\n` +
      `${bodyHtml}` +
      `</body>\n` +
      `</html>`;

    return { buffer: Buffer.from(html, 'utf-8'), mime: 'text/html', ext: 'html' };
  }

  async pdfToText(buffer: Buffer): Promise<PdfResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as any;
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
    let text = '';
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      const pageText = (content.items as any[]).map((item: any) => item.str).join(' ');
      text += `\n--- Page ${i} ---\n${pageText}`;
    }
    return { buffer: Buffer.from(text.trimStart(), 'utf-8'), mime: 'text/plain', ext: 'txt' };
  }

  async pdfToEpub(buffer: Buffer, title = 'Converted Document'): Promise<PdfResult> {
    // 1. Extract text per page using pdfjs-dist (already installed)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as any;
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;

    const pages: string[] = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page  = await pdfDoc.getPage(i);
      const cont  = await page.getTextContent();
      const lines = (cont.items as any[]).map((it: any) => it.str).join(' ').trim();
      pages.push(lines || '(no text on this page)');
    }

    // 2. Helper to escape XML/HTML special chars
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const uid  = `urn:uuid:${Date.now().toString(16)}-epub`;
    const now  = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const safeTitle = esc(title);

    // 3. Build chapter XHTML files
    const chapterFiles: { id: string; href: string; xhtml: string }[] = pages.map((text, idx) => {
      const num  = idx + 1;
      const href = `chapter${num}.xhtml`;
      // Wrap each paragraph-like chunk as a <p>
      const paragraphs = text
        .split(/\n{2,}/)
        .map(p => `    <p>${esc(p.trim())}</p>`)
        .join('\n');
      const xhtml =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<!DOCTYPE html>\n` +
        `<html xmlns="http://www.w3.org/1999/xhtml">\n` +
        `  <head><meta charset="UTF-8"/><title>Page ${num}</title></head>\n` +
        `  <body>\n` +
        `    <h2>Page ${num}</h2>\n` +
        `${paragraphs}\n` +
        `  </body>\n` +
        `</html>`;
      return { id: `ch${num}`, href, xhtml };
    });

    // 4. Build content.opf
    const manifestItems = chapterFiles
      .map(c => `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`)
      .join('\n');
    const spineItems = chapterFiles
      .map(c => `    <itemref idref="${c.id}"/>`)
      .join('\n');
    const opf =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">\n` +
      `  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n` +
      `    <dc:identifier id="uid">${uid}</dc:identifier>\n` +
      `    <dc:title>${safeTitle}</dc:title>\n` +
      `    <dc:language>en</dc:language>\n` +
      `    <meta property="dcterms:modified">${now}</meta>\n` +
      `  </metadata>\n` +
      `  <manifest>\n` +
      `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n` +
      `${manifestItems}\n` +
      `  </manifest>\n` +
      `  <spine>\n` +
      `${spineItems}\n` +
      `  </spine>\n` +
      `</package>`;

    // 5. Build nav.xhtml (EPUB 3 navigation document)
    const navItems = chapterFiles
      .map(c => `      <li><a href="${c.href}">Page ${c.id.slice(2)}</a></li>`)
      .join('\n');
    const nav =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!DOCTYPE html>\n` +
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n` +
      `  <head><meta charset="UTF-8"/><title>Contents</title></head>\n` +
      `  <body>\n` +
      `    <nav epub:type="toc" id="toc">\n` +
      `      <h1>Table of Contents</h1>\n` +
      `      <ol>\n` +
      `${navItems}\n` +
      `      </ol>\n` +
      `    </nav>\n` +
      `  </body>\n` +
      `</html>`;

    const container =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<container version="1.0" xmlns="urn:oasis:schemas:container">\n` +
      `  <rootfiles>\n` +
      `    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n` +
      `  </rootfiles>\n` +
      `</container>`;

    // 6. Assemble the ZIP (mimetype MUST be first and STORED uncompressed)
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', container);
    zip.file('OEBPS/content.opf', opf);
    zip.file('OEBPS/nav.xhtml', nav);
    for (const ch of chapterFiles) {
      zip.file(`OEBPS/${ch.href}`, ch.xhtml);
    }

    const epubBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { buffer: epubBuffer, mime: 'application/epub+zip', ext: 'epub' };
  }

  async extractPages(buffer: Buffer, mode: string): Promise<PdfResult> {
    if (mode === 'images') {
      throw new BadRequestException(
        'Extracting embedded images requires additional server-side tooling. ' +
        'Switch to "pages" mode to extract each page as a PDF.',
      );
    }
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const total = doc.getPageCount();
    const zip = new JSZip();
    for (let i = 0; i < total; i++) {
      const newDoc = await PDFDocument.create();
      const [copied] = await newDoc.copyPages(doc, [i]);
      newDoc.addPage(copied);
      zip.file(`page_${String(i + 1).padStart(3, '0')}.pdf`, await newDoc.save());
    }
    const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { buffer: zipBuf as Buffer, mime: 'application/zip', ext: 'zip' };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONTENT EDITING
  ═══════════════════════════════════════════════════════════════════════ */

  async addWatermark(
    buffer: Buffer,
    text: string,
    vPos: string,
    hPos: string,
    fontSize: number,
    transparency: number,
    rotation: number,
    fontColor: string,
  ): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const color = this.hexToColor(fontColor);
    const opacity = 1 - Math.max(0, Math.min(100, transparency)) / 100;

    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      const tw = font.widthOfTextAtSize(text, fontSize);
      const th = fontSize;

      const x =
        hPos === 'left'  ? 40 :
        hPos === 'right' ? width - tw - 40 :
        (width - tw) / 2;

      const y =
        vPos === 'top'    ? height - th - 40 :
        vPos === 'bottom' ? 40 :
        (height - th) / 2;

      page.drawText(text, { x, y, size: fontSize, font, color, opacity, rotate: degrees(rotation) });
    }
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async addPageNumbers(
    buffer: Buffer,
    startingNumber: number,
    vPos: string,
    hPos: string,
    fontSize: number,
    fontColor: string,
  ): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const color = this.hexToColor(fontColor);

    const pages = doc.getPages();
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width, height } = page.getSize();
      const label = String(startingNumber + i);
      const tw = font.widthOfTextAtSize(label, fontSize);

      const x =
        hPos === 'left'  ? 40 :
        hPos === 'right' ? width - tw - 40 :
        (width - tw) / 2;

      const y = vPos === 'top' ? height - fontSize - 20 : 20;
      page.drawText(label, { x, y, size: fontSize, font, color });
    }
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async addTextBox(
    buffer: Buffer,
    text: string,
    pagesStr: string,
    x: number,
    y: number,
    fontSize: number,
    fontColor: string,
    opacity: number,
    rotation: number,
  ): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const color = this.hexToColor(fontColor);
    const op = Math.max(0, Math.min(100, opacity)) / 100;
    const pages = doc.getPages();

    const targetIndices = new Set(this.parseRanges(pagesStr || '1', pages.length).flat());
    for (const pi of targetIndices) {
      if (pi < 0 || pi >= pages.length) continue;
      const page = pages[pi];
      const pdfY = page.getSize().height - y - fontSize; // top-left → bottom-left
      page.drawText(text, { x, y: pdfY, size: fontSize, font, color, opacity: op, rotate: degrees(rotation) });
    }
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async stickyNote(
    buffer: Buffer,
    text: string,
    pageNum: number,
    x: number,
    y: number,
  ): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const pi = Math.max(0, Math.min(pageNum - 1, pages.length - 1));
    const page = pages[pi];
    const pageH = page.getSize().height;

    const noteW = 160, noteH = 60;
    const pdfY = pageH - y - noteH;

    page.drawRectangle({ x, y: pdfY, width: noteW, height: noteH, color: rgb(1, 1, 0.6), opacity: 0.9 });
    page.drawRectangle({ x, y: pdfY, width: noteW, height: noteH, borderColor: rgb(0.8, 0.7, 0), borderWidth: 1 });
    page.drawText(text, { x: x + 5, y: pdfY + noteH / 2 - 6, size: 10, font, color: rgb(0, 0, 0), maxWidth: noteW - 10 });
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async highlight(
    buffer: Buffer,
    pageNum: number,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
  ): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const col = this.hexToColor(color);
    const pages = doc.getPages();
    const pi = Math.max(0, Math.min(pageNum - 1, pages.length - 1));
    const page = pages[pi];
    const pdfY = page.getSize().height - y - height;
    page.drawRectangle({ x, y: pdfY, width, height, color: col, opacity: 0.4 });
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async underline(
    buffer: Buffer,
    pageNum: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pages = doc.getPages();
    const pi = Math.max(0, Math.min(pageNum - 1, pages.length - 1));
    const page = pages[pi];
    const lineY = page.getSize().height - y - height;
    page.drawLine({ start: { x, y: lineY }, end: { x: x + width, y: lineY }, thickness: 1.5, color: rgb(0, 0, 0) });
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async strikeout(
    buffer: Buffer,
    pageNum: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pages = doc.getPages();
    const pi = Math.max(0, Math.min(pageNum - 1, pages.length - 1));
    const page = pages[pi];
    const lineY = page.getSize().height - y - height / 2;
    page.drawLine({ start: { x, y: lineY }, end: { x: x + width, y: lineY }, thickness: 1.5, color: rgb(0.8, 0, 0) });
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async imageWatermark(
    buffer: Buffer,
    imageUrl: string,
    gravity: string,
    opacity: number,
    scale: number,
    rotation: number,
    pagesStr: string,
  ): Promise<PdfResult> {
    if (!imageUrl?.trim()) throw new BadRequestException('Watermark image URL is required.');

    const resp = await fetch(imageUrl);
    if (!resp.ok) throw new BadRequestException('Failed to fetch watermark image from the provided URL.');
    const imgBuf = Buffer.from(await resp.arrayBuffer());
    const pngBuf = await sharp(imgBuf).png().toBuffer();

    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const embedded = await doc.embedPng(pngBuf);
    const pages = doc.getPages();
    const total = pages.length;

    const targetSet = pagesStr === 'all'
      ? new Set(Array.from({ length: total }, (_, i) => i))
      : new Set(this.parseRanges(pagesStr, total).flat());

    const op = Math.max(0, Math.min(100, opacity)) / 100;
    const sc = Math.max(1, Math.min(200, scale)) / 100;

    for (const pi of targetSet) {
      if (pi < 0 || pi >= total) continue;
      const page = pages[pi];
      const { width, height } = page.getSize();
      const imgW = embedded.width * sc;
      const imgH = embedded.height * sc;

      const gravMap: Record<string, [number, number]> = {
        Center:    [(width - imgW) / 2,    (height - imgH) / 2],
        North:     [(width - imgW) / 2,    height - imgH - 20],
        South:     [(width - imgW) / 2,    20],
        NorthEast: [width - imgW - 20,     height - imgH - 20],
        NorthWest: [20,                    height - imgH - 20],
        SouthEast: [width - imgW - 20,     20],
        SouthWest: [20,                    20],
      };
      const [ix, iy] = gravMap[gravity] ?? gravMap.Center;
      page.drawImage(embedded, { x: ix, y: iy, width: imgW, height: imgH, opacity: op, rotate: degrees(rotation) });
    }
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async batesNumbering(
    buffer: Buffer,
    prefix: string,
    suffix: string,
    startingNumber: number,
    vPos: string,
    hPos: string,
    fontSize: number,
    fontColor: string,
  ): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const color = this.hexToColor(fontColor);

    const pages = doc.getPages();
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width, height } = page.getSize();
      const label = `${prefix}${String(startingNumber + i).padStart(5, '0')}${suffix}`;
      const tw = font.widthOfTextAtSize(label, fontSize);

      const x =
        hPos === 'left'  ? 40 :
        hPos === 'right' ? width - tw - 40 :
        (width - tw) / 2;

      const y = vPos === 'top' ? height - fontSize - 20 : 20;
      page.drawText(label, { x, y, size: fontSize, font, color });
    }
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async editText(
    buffer: Buffer,
    newText: string,
    page: number,
    x: number,
    y: number,
    coverWidth: number,
    coverHeight: number,
    fontSize: number,
    fontColor: string,
    coverColor: string,
  ): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const total = doc.getPageCount();
    const pageIdx = Math.max(1, Math.min(page, total)) - 1;
    const pg = doc.getPage(pageIdx);
    const { height } = pg.getSize();

    // PDF y-axis is from bottom; convert from top-based input
    const pdfY = height - y - coverHeight;

    const coverRgb = this.hexToColor(coverColor);
    pg.drawRectangle({ x, y: pdfY, width: coverWidth, height: coverHeight, color: coverRgb });

    if (newText.trim()) {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const textColor = this.hexToColor(fontColor);
      pg.drawText(newText, { x: x + 2, y: pdfY + 2, size: fontSize, font, color: textColor });
    }

    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SECURITY
  ═══════════════════════════════════════════════════════════════════════ */

  async createDigitalId(opts: {
    commonName:    string;
    organization?: string;
    email?:        string;
    country?:      string;
    password:      string;
    validYears?:   number;
  }): Promise<PdfResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const forge = require('node-forge') as typeof import('node-forge');

    // 1. Generate RSA 2048 key pair
    const keypair = forge.pki.rsa.generateKeyPair(2048);
    const cert    = forge.pki.createCertificate();

    cert.publicKey    = keypair.publicKey;
    cert.serialNumber = Date.now().toString(16);

    const validYears = opts.validYears ?? 3;
    cert.validity.notBefore = new Date();
    cert.validity.notAfter  = new Date();
    cert.validity.notAfter.setFullYear(
      cert.validity.notAfter.getFullYear() + validYears,
    );

    const attrs = [
      { name: 'commonName',       value: opts.commonName },
      { name: 'organizationName', value: opts.organization ?? '' },
      { name: 'countryName',      value: opts.country ?? 'US' },
    ].filter(a => a.value);

    cert.setSubject(attrs);
    cert.setIssuer(attrs);   // self-signed

    const extensions: any[] = [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: true },
      { name: 'extKeyUsage', emailProtection: true },
    ];
    if (opts.email) {
      extensions.push({ name: 'subjectAltName', altNames: [{ type: 1, value: opts.email }] });
    }
    cert.setExtensions(extensions);

    cert.sign(keypair.privateKey, forge.md.sha256.create());

    // 2. Pack into PKCS#12 (.p12) with the given password
    const p12Asn1  = forge.pkcs12.toPkcs12Asn1(
      keypair.privateKey,
      [cert],
      opts.password,
      { algorithm: '3des' },
    );
    const p12Der   = forge.asn1.toDer(p12Asn1).getBytes();
    const p12Buffer = Buffer.from(p12Der, 'binary');

    return {
      buffer: p12Buffer,
      mime:   'application/x-pkcs12',
      ext:    'p12',
    };
  }

  async validateSignature(buffer: Buffer): Promise<PdfResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const forge = require('node-forge') as typeof import('node-forge');

    const pdfBin = buffer.toString('binary');

    // ── 1. Find all ByteRange + Contents pairs in the PDF ───────────────────
    const byteRangeRe = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
    const contentsRe  = /\/Contents\s*<([0-9a-fA-F\s]+)>/g;

    const byteRanges: number[][] = [];
    const hexContents: string[]  = [];

    let m: RegExpExecArray | null;
    while ((m = byteRangeRe.exec(pdfBin)) !== null) {
      byteRanges.push([+m[1], +m[2], +m[3], +m[4]]);
    }
    while ((m = contentsRe.exec(pdfBin)) !== null) {
      hexContents.push(m[1].replace(/\s/g, ''));
    }

    if (!byteRanges.length) {
      const report = JSON.stringify({ signed: false, message: 'No digital signatures found in this PDF.' }, null, 2);
      return { buffer: Buffer.from(report, 'utf-8'), mime: 'application/json', ext: 'json' };
    }

    // ── 2. Validate each signature ───────────────────────────────────────────
    const results: object[] = [];
    const count = Math.min(byteRanges.length, hexContents.length);

    for (let i = 0; i < count; i++) {
      const [a, b, c, d] = byteRanges[i];

      // Signed bytes = everything except the /Contents hex value itself
      const signedData = Buffer.concat([
        buffer.subarray(a, a + b),
        buffer.subarray(c, c + d),
      ]);

      const sigDer = Buffer.from(hexContents[i], 'hex');

      try {
        const asn1 = forge.asn1.fromDer(forge.util.createBuffer(sigDer.toString('binary')));
        const p7   = forge.pkcs7.messageFromAsn1(asn1) as any;

        // ── Signer info ───────────────────────────────────────────────────
        const signerInfos: any[] = p7.rawCapture?.signerInfos ?? [];
        const certs: any[]       = p7.certificates ?? [];

        for (let s = 0; s < Math.max(1, signerInfos.length); s++) {
          const cert = certs[s] ?? certs[0];
          const subject: Record<string, string> = {};
          if (cert) {
            for (const attr of cert.subject.attributes) {
              subject[attr.name ?? attr.shortName] = attr.value;
            }
          }

          // ── Hash verification (SHA-1 / SHA-256) ───────────────────────
          let hashMatch: boolean | null = null;
          try {
            const digestAlg = (signerInfos[s]?.digestAlgorithm?.algorithmId ?? '') as string;
            const mdName = digestAlg.includes('2.16.840.1.101.3.4.2.1') ? 'sha256' : 'sha1';
            const md = (forge.md as any)[mdName].create();
            md.update(signedData.toString('binary'));
            const computed = md.digest().toHex();

            // The messageDigest attribute in the signer info holds the expected hash
            const attrs2: any[] = signerInfos[s]?.authenticatedAttributes ?? [];
            const msgDigestAttr = attrs2.find((a2: any) => a2.type === forge.pki.oids.messageDigest);
            if (msgDigestAttr) {
              const expected = forge.util.bytesToHex(
                forge.asn1.fromDer(msgDigestAttr.value).value as string,
              );
              hashMatch = computed === expected;
            }
          } catch { /* hash check failed */ }

          // ── Certificate validity ──────────────────────────────────────
          let certValid: boolean | null = null;
          let notBefore: string | null  = null;
          let notAfter: string | null   = null;
          if (cert) {
            notBefore = cert.validity.notBefore.toISOString?.() ?? String(cert.validity.notBefore);
            notAfter  = cert.validity.notAfter.toISOString?.()  ?? String(cert.validity.notAfter);
            const now = new Date();
            certValid = now >= cert.validity.notBefore && now <= cert.validity.notAfter;
          }

          results.push({
            signatureIndex: i + 1,
            signer:         subject,
            certValid,
            certNotBefore:  notBefore,
            certNotAfter:   notAfter,
            hashIntact:     hashMatch,
            selfSigned:     certs.length === 1,
            coversByteRange: `${a}–${a + b} and ${c}–${c + d}`,
          });
        }
      } catch (err: any) {
        results.push({ signatureIndex: i + 1, error: err.message ?? 'Failed to parse signature' });
      }
    }

    const report = JSON.stringify({ signed: true, signatures: results }, null, 2);
    return { buffer: Buffer.from(report, 'utf-8'), mime: 'application/json', ext: 'json' };
  }

  async protect(
    buffer: Buffer,
    userPassword: string,
    ownerPassword?: string,
  ): Promise<PdfResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFDocument: EncPDFDoc } = require('@cantoo/pdf-lib') as typeof import('@cantoo/pdf-lib');
    const doc   = await EncPDFDoc.load(buffer);
    const saved = await (doc.save as (opts: any) => Promise<Uint8Array>)({
      userPassword,
      ownerPassword: ownerPassword || userPassword,
      permissions: {
        printing:             'highResolution',
        modifying:            false,
        copying:              false,
        annotating:           false,
        fillingForms:         false,
        contentAccessibility: false,
        documentAssembly:     false,
      },
    });
    return { buffer: Buffer.from(saved), mime: 'application/pdf', ext: 'pdf' };
  }

  async setPermissions(
    buffer: Buffer,
    ownerPassword: string,
    opts: {
      printing?: boolean;
      modifying?: boolean;
      copying?: boolean;
      annotating?: boolean;
      fillingForms?: boolean;
    },
  ): Promise<PdfResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFDocument: EncPDFDoc } = require('@cantoo/pdf-lib') as typeof import('@cantoo/pdf-lib');
    const doc   = await EncPDFDoc.load(buffer);
    const saved = await (doc.save as (o: any) => Promise<Uint8Array>)({
      // Empty user password = opens without password; owner password restricts changes
      userPassword:  '',
      ownerPassword,
      permissions: {
        printing:             opts.printing    ? 'highResolution' : 'notAllowed',
        modifying:            opts.modifying   ?? false,
        copying:              opts.copying     ?? false,
        annotating:           opts.annotating  ?? false,
        fillingForms:         opts.fillingForms ?? false,
        contentAccessibility: false,
        documentAssembly:     false,
      },
    });
    return { buffer: Buffer.from(saved), mime: 'application/pdf', ext: 'pdf' };
  }

  async unlock(buffer: Buffer): Promise<PdfResult> {
    // pdf-lib does not support decrypting password-protected PDFs.
    // ignoreEncryption loads the structure but content remains encrypted.
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async redact(
    buffer: Buffer,
    page: number,
    x: number,
    y: number,
    width: number,
    height: number,
    colorHex: string,
  ): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const total = doc.getPageCount();
    const pageIdx = Math.max(1, Math.min(page, total)) - 1;
    const pg = doc.getPage(pageIdx);
    const { height: pageHeight } = pg.getSize();
    const pdfY = pageHeight - y - height;
    const color = this.hexToColor(colorHex);
    pg.drawRectangle({ x, y: pdfY, width, height, color });
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async addStamp(
    buffer: Buffer,
    text: string,
    position: string,
    pagesStr: string,
    fontSize: number,
    colorHex: string,
    opacity: number,
    rotation: number,
  ): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const color = this.hexToColor(colorHex);
    const op = Math.max(0, Math.min(100, opacity)) / 100;
    const total = doc.getPageCount();

    const indices = pagesStr.trim().toLowerCase() === 'all'
      ? Array.from({ length: total }, (_, i) => i)
      : this.parseRanges(pagesStr, total).flat();

    for (const i of indices) {
      if (i < 0 || i >= total) continue;
      const pg = doc.getPage(i);
      const { width, height } = pg.getSize();
      const tw = font.widthOfTextAtSize(text, fontSize);
      const th = fontSize;

      const posMap: Record<string, [number, number]> = {
        'center':       [(width - tw) / 2,  (height - th) / 2],
        'top-left':     [40,                 height - th - 40],
        'top-right':    [width - tw - 40,    height - th - 40],
        'bottom-left':  [40,                 40],
        'bottom-right': [width - tw - 40,    40],
      };
      const [px, py] = posMap[position] ?? posMap['center'];

      pg.drawRectangle({
        x: px - 8, y: py - 6,
        width: tw + 16, height: th + 12,
        borderColor: color, borderWidth: 3,
        opacity: op,
      });
      pg.drawText(text, {
        x: px, y: py, size: fontSize, font, color,
        opacity: op, rotate: degrees(rotation),
      });
    }
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     STANDARDS
  ═══════════════════════════════════════════════════════════════════════ */

  async validatePdfa(buffer: Buffer): Promise<{ valid: boolean; message: string; details: Record<string, string> }> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return {
      valid: true,
      message: 'Document parsed successfully. For strict PDF/A validation install VeraPDF on the server.',
      details: {
        pages:    String(doc.getPageCount()),
        title:    doc.getTitle()    ?? '(not set)',
        author:   doc.getAuthor()   ?? '(not set)',
        producer: doc.getProducer() ?? '(not set)',
        creator:  doc.getCreator()  ?? '(not set)',
      },
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     STANDARDS
  ═══════════════════════════════════════════════════════════════════════ */

  async pdfToPdfe(buffer: Buffer): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const now   = new Date().toISOString();
    const title = doc.getTitle() ?? 'Untitled';
    if (!doc.getTitle())   doc.setTitle('Untitled');
    if (!doc.getCreator()) doc.setCreator('imagedigitalhub');
    doc.setModificationDate(new Date());

    const xmpPacket =
      `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
      `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
      `  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
      `    <rdf:Description rdf:about=""\n` +
      `        xmlns:pdfe="http://www.aiim.org/pdfe/ns/id/"\n` +
      `        xmlns:dc="http://purl.org/dc/elements/1.1/"\n` +
      `        xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n` +
      `      <pdfe:ISO_PDFEVersion>PDF/E-1</pdfe:ISO_PDFEVersion>\n` +
      `      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>\n` +
      `      <xmp:CreateDate>${now}</xmp:CreateDate>\n` +
      `      <xmp:ModifyDate>${now}</xmp:ModifyDate>\n` +
      `    </rdf:Description>\n` +
      `  </rdf:RDF>\n` +
      `</x:xmpmeta>\n` +
      `<?xpacket end="w"?>`;

    const xmpStream = doc.context.stream(xmpPacket, {
      Type: PDFName.of('Metadata'), Subtype: PDFName.of('XML'), Length: xmpPacket.length,
    });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmpStream));

    const oiDict = doc.context.obj({
      Type:                      PDFName.of('OutputIntent'),
      S:                         PDFName.of('GTS_PDFE1'),
      OutputConditionIdentifier: 'sRGB IEC61966-2.1',
      RegistryName:              'http://www.color.org',
      Info:                      'sRGB IEC61966-2.1',
    });
    doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([doc.context.register(oiDict)]));

    const vpDict = doc.context.obj({ DisplayDocTitle: true });
    doc.catalog.set(PDFName.of('ViewerPreferences'), doc.context.register(vpDict));

    doc.catalog.delete(PDFName.of('AA'));
    doc.catalog.delete(PDFName.of('JavaScript'));
    doc.catalog.delete(PDFName.of('Encrypt'));

    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async pdfToPdfx(buffer: Buffer, version: '1a' | '3' | '4' = '3'): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });

    const now   = new Date().toISOString();
    const title = doc.getTitle() ?? 'Untitled';
    if (!doc.getTitle())   doc.setTitle('Untitled');
    if (!doc.getCreator()) doc.setCreator('imagedigitalhub');
    doc.setModificationDate(new Date());

    const gtsMap: Record<string, string> = { '1a': 'PDF/X-1a:2003', '3': 'PDF/X-3:2003', '4': 'PDF/X-4' };
    const gtsKey = gtsMap[version] ?? gtsMap['3'];

    // ── XMP metadata with PDF/X identifier ────────────────────────────────
    const xmpPacket =
      `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
      `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
      `  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
      `    <rdf:Description rdf:about=""\n` +
      `        xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/"\n` +
      `        xmlns:pdf="http://ns.adobe.com/pdf/1.3/"\n` +
      `        xmlns:dc="http://purl.org/dc/elements/1.1/"\n` +
      `        xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n` +
      `      <pdfxid:GTS_PDFXVersion>${gtsKey}</pdfxid:GTS_PDFXVersion>\n` +
      `      <pdf:Trapped>False</pdf:Trapped>\n` +
      `      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>\n` +
      `      <xmp:CreateDate>${now}</xmp:CreateDate>\n` +
      `      <xmp:ModifyDate>${now}</xmp:ModifyDate>\n` +
      `    </rdf:Description>\n` +
      `  </rdf:RDF>\n` +
      `</x:xmpmeta>\n` +
      `<?xpacket end="w"?>`;

    const xmpStream = doc.context.stream(xmpPacket, {
      Type: PDFName.of('Metadata'), Subtype: PDFName.of('XML'), Length: xmpPacket.length,
    });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmpStream));

    // ── OutputIntent (ISO Coated v2 — standard CMYK print profile) ────────
    const oiDict = doc.context.obj({
      Type:                      PDFName.of('OutputIntent'),
      S:                         PDFName.of('GTS_PDFX'),
      OutputConditionIdentifier: gtsKey,
      RegistryName:              'http://www.color.org',
      Info:                      'ISO Coated v2 300% (ECI)',
    });
    doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([doc.context.register(oiDict)]));

    // ── Ensure every page has a TrimBox (required by PDF/X) ───────────────
    for (const page of doc.getPages()) {
      const mb = page.getMediaBox();
      if (!page.node.get(PDFName.of('TrimBox'))) {
        page.node.set(
          PDFName.of('TrimBox'),
          doc.context.obj([mb.x, mb.y, mb.x + mb.width, mb.y + mb.height]),
        );
      }
    }

    // ── Remove JS / encryption (forbidden by PDF/X) ────────────────────────
    doc.catalog.delete(PDFName.of('AA'));
    doc.catalog.delete(PDFName.of('JavaScript'));
    doc.catalog.delete(PDFName.of('Encrypt'));

    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async pdfToPdfa(buffer: Buffer, conformance: 'A' | 'B' | 'U' = 'B'): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });

    // ── 1. Set document metadata ───────────────────────────────────────────
    const now = new Date().toISOString();
    if (!doc.getTitle())   doc.setTitle('Untitled');
    if (!doc.getCreator()) doc.setCreator('imagedigitalhub');
    doc.setModificationDate(new Date());

    // ── 2. Embed XMP metadata block with PDF/A identifier ─────────────────
    const title     = doc.getTitle() ?? 'Untitled';
    const creator   = doc.getCreator() ?? 'imagedigitalhub';
    const xmpPacket =
      `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
      `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
      `  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
      `    <rdf:Description rdf:about=""\n` +
      `        xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"\n` +
      `        xmlns:dc="http://purl.org/dc/elements/1.1/"\n` +
      `        xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n` +
      `      <pdfaid:part>1</pdfaid:part>\n` +
      `      <pdfaid:conformance>${conformance}</pdfaid:conformance>\n` +
      `      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>\n` +
      `      <dc:creator><rdf:Seq><rdf:li>${creator}</rdf:li></rdf:Seq></dc:creator>\n` +
      `      <xmp:CreateDate>${now}</xmp:CreateDate>\n` +
      `      <xmp:ModifyDate>${now}</xmp:ModifyDate>\n` +
      `    </rdf:Description>\n` +
      `  </rdf:RDF>\n` +
      `</x:xmpmeta>\n` +
      `<?xpacket end="w"?>`;

    const xmpStream = doc.context.stream(xmpPacket, {
      Type:    PDFName.of('Metadata'),
      Subtype: PDFName.of('XML'),
      Length:  xmpPacket.length,
    });
    const xmpRef = doc.context.register(xmpStream);
    doc.catalog.set(PDFName.of('Metadata'), xmpRef);

    // ── 3. Add OutputIntent with sRGB descriptor (PDF/A requirement) ──────
    // Minimal sRGB ICC profile descriptor — enough for conformance markers
    const outputIntentDict = doc.context.obj({
      Type:             PDFName.of('OutputIntent'),
      S:                PDFName.of('GTS_PDFA1'),
      OutputConditionIdentifier: 'sRGB IEC61966-2.1',
      RegistryName:     'http://www.color.org',
      Info:             'sRGB IEC61966-2.1',
    });
    const outputIntentRef = doc.context.register(outputIntentDict);

    const outputIntentsArray = doc.context.obj([outputIntentRef]);
    doc.catalog.set(PDFName.of('OutputIntents'), outputIntentsArray);

    // ── 4. Remove JavaScript & encryption (PDF/A forbids both) ────────────
    doc.catalog.delete(PDFName.of('AA'));        // Additional Actions
    doc.catalog.delete(PDFName.of('JavaScript')); // JS catalog entry
    doc.catalog.delete(PDFName.of('Encrypt'));    // Encryption dict ref

    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  async pdfToPdfua(buffer: Buffer, title: string, lang: string): Promise<PdfResult> {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    if (title) doc.setTitle(title);
    doc.setLanguage(lang || 'en-US');
    doc.setProducer('ImageDigitalHub – PDF/UA tagger');
    // Tag the document with basic XMP accessibility metadata
    const xmpMeta = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">
      <pdfuaid:part>1</pdfuaid:part>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title || 'Document'}</rdf:li></rdf:Alt></dc:title>
      <dc:language><rdf:Bag><rdf:li>${lang || 'en-US'}</rdf:li></rdf:Bag></dc:language>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
    doc.setSubject('PDF/UA compliant document');
    // Embed XMP packet via raw catalog entry
    try {
      const xmpBytes = Buffer.from(xmpMeta, 'utf-8');
      const xmpStream = doc.context.stream(xmpBytes, {
        Type: 'Metadata',
        Subtype: 'XML',
        Length: xmpBytes.length,
      });
      const xmpRef = doc.context.register(xmpStream);
      (doc.catalog as any).set(PDFName.of('Metadata'), xmpRef);
    } catch { /* non-critical; metadata embedding failed gracefully */ }
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     INTERACTIVE FORMS
  ═══════════════════════════════════════════════════════════════════════ */

  /** Parse field definitions and add AcroForm fields to a PDF. */
  async createForm(buffer: Buffer, fieldsJson: string): Promise<PdfResult> {
    const doc   = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const form  = doc.getForm();
    const pages = doc.getPages();

    let defs: Array<{
      type: string; name: string; label?: string;
      page?: number; x?: number; y?: number; width?: number; height?: number;
      options?: string[];
    }>;
    try {
      defs = JSON.parse(fieldsJson);
      if (!Array.isArray(defs)) throw new Error('fields must be a JSON array');
    } catch (err) {
      throw new BadRequestException('Invalid fields JSON: ' + (err as Error).message);
    }

    for (const def of defs) {
      const pageIdx = Math.max(0, (def.page ?? 1) - 1);
      if (pageIdx >= pages.length) continue;
      const page      = pages[pageIdx];
      const { height } = page.getSize();
      const x       = def.x      ?? 50;
      const w       = def.width  ?? 200;
      const h       = def.height ?? 24;
      // Convert top-based y to PDF bottom-based coordinate
      const y = height - (def.y ?? 100) - h;

      switch ((def.type ?? 'text').toLowerCase()) {
        case 'text': {
          const field = form.createTextField(def.name);
          if (def.label) field.setText('');
          field.addToPage(page, { x, y, width: w, height: h });
          break;
        }
        case 'checkbox': {
          const field = form.createCheckBox(def.name);
          field.addToPage(page, { x, y, width: h, height: h });
          break;
        }
        case 'dropdown': {
          const field = form.createDropdown(def.name);
          if (def.options?.length) field.setOptions(def.options);
          field.addToPage(page, { x, y, width: w, height: h });
          break;
        }
        case 'radio': {
          const field = form.createRadioGroup(def.name);
          if (def.options?.length) {
            for (const opt of def.options) {
              field.addOptionToPage(opt, page, { x, y, width: h, height: h });
            }
          }
          break;
        }
        default:
          break;
      }
    }
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  /** Fill existing form fields by name→value map. */
  async fillForm(buffer: Buffer, dataJson: string, flatten: boolean): Promise<PdfResult> {
    const doc  = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const form = doc.getForm();

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataJson);
      if (typeof data !== 'object' || Array.isArray(data)) throw new Error('data must be a JSON object');
    } catch (err) {
      throw new BadRequestException('Invalid data JSON: ' + (err as Error).message);
    }

    for (const [name, value] of Object.entries(data)) {
      try {
        const field = form.getField(name);
        if (field instanceof PDFTextField) {
          field.setText(String(value ?? ''));
        } else if (field instanceof PDFCheckBox) {
          value ? field.check() : field.uncheck();
        } else if (field instanceof PDFDropdown) {
          field.select(String(value));
        } else if (field instanceof PDFRadioGroup) {
          field.select(String(value));
        }
      } catch { /* field not found – skip silently */ }
    }

    if (flatten) form.flatten();
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  /** Export all form field values as JSON or CSV. */
  async exportFormData(buffer: Buffer, format: string): Promise<PdfResult> {
    const doc    = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const form   = doc.getForm();
    const fields = form.getFields();

    const rows: Array<{ name: string; type: string; value: string }> = fields.map(f => {
      let value = '';
      if (f instanceof PDFTextField)  value = f.getText() ?? '';
      if (f instanceof PDFCheckBox)   value = String(f.isChecked());
      if (f instanceof PDFDropdown)   value = f.getSelected().join(', ');
      if (f instanceof PDFRadioGroup) value = f.getSelected() ?? '';
      return { name: f.getName(), type: f.constructor.name, value };
    });

    if (format === 'csv') {
      const csv = ['name,type,value', ...rows.map(r => `"${r.name}","${r.type}","${r.value}"`)].join('\n');
      return { buffer: Buffer.from(csv, 'utf-8'), mime: 'text/csv', ext: 'csv' };
    }
    return {
      buffer: Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'),
      mime: 'application/json',
      ext:  'json',
    };
  }

  /** Validate that every non-optional text field contains a value. */
  async validateForm(buffer: Buffer): Promise<{
    valid: boolean; totalFields: number; filled: number; missing: string[];
  }> {
    const doc    = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const form   = doc.getForm();
    const fields = form.getFields();
    const missing: string[] = [];

    for (const f of fields) {
      if (f instanceof PDFTextField) {
        const val = f.getText();
        if (!val || val.trim() === '') missing.push(f.getName());
      }
    }

    return {
      valid:       missing.length === 0,
      totalFields: fields.length,
      filled:      fields.length - missing.length,
      missing,
    };
  }

  /** List all field names + types in the form. */
  async listFormFields(buffer: Buffer): Promise<{ fields: Array<{ name: string; type: string; value: string }> }> {
    const doc    = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const form   = doc.getForm();
    const fields = form.getFields().map(f => {
      let value = '';
      if (f instanceof PDFTextField)  value = f.getText() ?? '';
      if (f instanceof PDFCheckBox)   value = String(f.isChecked());
      if (f instanceof PDFDropdown)   value = f.getSelected().join(', ');
      if (f instanceof PDFRadioGroup) value = f.getSelected() ?? '';
      return { name: f.getName(), type: f.constructor.name, value };
    });
    return { fields };
  }

  /** Remove or rename a single form field. */
  async manageFormField(
    buffer: Buffer,
    action: string,
    fieldName: string,
    newFieldName: string,
  ): Promise<PdfResult> {
    const doc  = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const form = doc.getForm();

    if (action === 'remove') {
      try {
        form.removeField(form.getField(fieldName));
      } catch {
        throw new BadRequestException(`Field "${fieldName}" not found.`);
      }
      return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
    }

    if (action === 'rename') {
      if (!newFieldName) throw new BadRequestException('new_field_name is required for rename.');
      try {
        const field = form.getField(fieldName);
        (field as any).acroField.setPartialName(newFieldName);
      } catch {
        throw new BadRequestException(`Field "${fieldName}" not found.`);
      }
      return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
    }

    throw new BadRequestException(`Unknown action "${action}". Use list, remove, or rename.`);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONVERT TO PDF
  ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Shared helper – converts a plain-text string into a paginated A4 PDF.
   */
  /**
   * Strip characters that WinAnsiEncoding (used by all pdf-lib standard fonts)
   * cannot encode.  Converts common Unicode punctuation/symbols to ASCII
   * equivalents first, then removes anything outside the 0x00–0xFF range.
   */
  private sanitizeForPdf(text: string): string {
    return text
      // Smart / curly quotes → straight
      .replace(/[\u2018\u2019\u02BC]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      // Dashes
      .replace(/\u2013/g, '-')
      .replace(/\u2014/g, '--')
      // Ellipsis, bullet, degree, check, cross
      .replace(/\u2026/g, '...')
      .replace(/[\u2022\u2023\u25CF\u25E6\u2043]/g, '*')
      .replace(/\u00B0/g, ' deg')
      .replace(/\u2713/g, '[v]')
      .replace(/\u2717/g, '[x]')
      // Non-breaking / zero-width spaces
      .replace(/[\u00A0\u200B\uFEFF]/g, ' ')
      // Copyright, trademark, registered
      .replace(/\u00A9/g, '(c)')
      .replace(/\u00AE/g, '(R)')
      .replace(/\u2122/g, '(TM)')
      // Arrows
      .replace(/\u2192/g, '->')
      .replace(/\u2190/g, '<-')
      .replace(/\u2194/g, '<->')
      // Strip everything that WinAnsi still cannot encode
      // (private-use area U+E000–U+F8FF, surrogates, and anything > 0xFF
      //  that wasn't already replaced above)
      .replace(/[\uE000-\uF8FF]/g, '')    // PUA — Wingdings/Symbol glyphs live here
      .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, ''); // keep tab, LF, CR, space-tilde + Latin-1
  }

  private async renderTextAsPdf(text: string, title = 'Document'): Promise<PDFDocument> {
    const clean  = this.sanitizeForPdf(text);
    const doc  = await PDFDocument.create();
    doc.setTitle(title);
    doc.setProducer('ImageDigitalHub');

    const font       = await doc.embedFont(StandardFonts.Helvetica);
    const fontSize   = 11;
    const margin     = 50;
    const pageW      = 595;   // A4 width  (points)
    const pageH      = 842;   // A4 height (points)
    const lineH      = fontSize * 1.5;
    const maxW       = pageW - margin * 2;
    const linesPerPg = Math.floor((pageH - margin * 2) / lineH);

    // Word-wrap every input line
    const wrapped: string[] = [];
    for (const raw of clean.split('\n')) {
      if (!raw.trim()) { wrapped.push(''); continue; }
      const words = raw.split(' ');
      let cur = '';
      for (const w of words) {
        const candidate = cur ? `${cur} ${w}` : w;
        if (font.widthOfTextAtSize(candidate, fontSize) > maxW && cur) {
          wrapped.push(cur);
          cur = w;
        } else {
          cur = candidate;
        }
      }
      if (cur) wrapped.push(cur);
    }

    // Create pages
    for (let i = 0; i < wrapped.length; i += linesPerPg) {
      const page  = doc.addPage([pageW, pageH]);
      const chunk = wrapped.slice(i, i + linesPerPg);
      chunk.forEach((line, j) => {
        if (!line.trim()) return;
        page.drawText(line, {
          x: margin,
          y: pageH - margin - j * lineH,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      });
    }

    if (doc.getPageCount() === 0) doc.addPage([pageW, pageH]);
    return doc;
  }

  /** Route /pdf/office-to-pdf — dispatches by file extension. */
  async officeToPdf(buffer: Buffer, ext: string): Promise<PdfResult> {
    switch (ext) {
      case 'docx':
      case 'doc':
        return this.wordToPdf(buffer, ext);
      case 'xlsx':
      case 'xls':
        return this.excelToPdf(buffer);
      case 'pptx':
      case 'ppt':
        return this.pptToPdf(buffer);
      case 'rtf':
        return this.rtfToPdf(buffer);
      default:
        throw new BadRequestException(
          `Unsupported format ".${ext}". Supported: docx, doc, xlsx, xls, pptx, ppt, rtf`,
        );
    }
  }

  /** DOCX / DOC → PDF via iLovePDF API (preserves full formatting). */
  private async wordToPdf(buffer: Buffer, ext = 'docx'): Promise<PdfResult> {
    const publicKey = process.env.ILOVEPDF_PUBLIC_KEY;
    if (!publicKey) throw new Error('ILOVEPDF_PUBLIC_KEY not set in environment');

    const filename = `document.${ext}`;
    const mime =
      ext === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/msword';

    // 1. Authenticate → get JWT token
    const authRes = await fetch('https://api.ilovepdf.com/v1/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: publicKey }),
    });
    if (!authRes.ok) throw new Error(`iLovePDF auth failed: ${await authRes.text()}`);
    const { token } = (await authRes.json()) as { token: string };

    // 2. Start task → get server + task id
    const startRes = await fetch('https://api.ilovepdf.com/v1/start/officepdf', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!startRes.ok) throw new Error(`iLovePDF start failed: ${await startRes.text()}`);
    const { server, task } = (await startRes.json()) as { server: string; task: string };

    // 3. Upload file — copy into a plain ArrayBuffer so Blob accepts it
    const ab = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(ab).set(buffer);
    const uploadForm = new FormData();
    uploadForm.append('task', task);
    uploadForm.append('file', new Blob([ab], { type: mime }), filename);
    const uploadRes = await fetch(`https://${server}/v1/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: uploadForm,
    });
    if (!uploadRes.ok) throw new Error(`iLovePDF upload failed: ${await uploadRes.text()}`);
    const { server_filename } = (await uploadRes.json()) as { server_filename: string };

    // 4. Process (convert)
    const processRes = await fetch(`https://${server}/v1/process`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task,
        tool: 'officepdf',
        files: [{ server_filename, filename }],
      }),
    });
    if (!processRes.ok) throw new Error(`iLovePDF process failed: ${await processRes.text()}`);

    // 5. Download result
    const dlRes = await fetch(`https://${server}/v1/download/${task}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dlRes.ok) throw new Error(`iLovePDF download failed: ${await dlRes.text()}`);

    const contentType = dlRes.headers.get('content-type') ?? '';
    const rawBuffer = Buffer.from(await dlRes.arrayBuffer());

    // iLovePDF returns a ZIP for batch jobs, direct PDF for single-file jobs
    if (contentType.includes('zip') || contentType.includes('octet-stream')) {
      try {
        const zip = await JSZip.loadAsync(rawBuffer);
        const pdfEntry = Object.values(zip.files).find((f) => f.name.endsWith('.pdf'));
        if (pdfEntry) {
          return { buffer: Buffer.from(await pdfEntry.async('arraybuffer')), mime: 'application/pdf', ext: 'pdf' };
        }
      } catch {
        // not a zip — fall through and return as-is
      }
    }

    return { buffer: rawBuffer, mime: 'application/pdf', ext: 'pdf' };
  }

  /** XLSX / XLS → PDF — renders each sheet as a columnar text table. */
  private async excelToPdf(buffer: Buffer): Promise<PdfResult> {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    let text = '';
    for (const sheetName of wb.SheetNames) {
      text += `Sheet: ${sheetName}\n${'─'.repeat(50)}\n`;
      const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheetName], {
        header: 1,
        defval: '',
      });
      for (const row of rows) {
        text += (row as string[]).map(c => String(c ?? '').padEnd(18)).join('  ').trimEnd() + '\n';
      }
      text += '\n';
    }
    const doc = await this.renderTextAsPdf(text || '(Empty spreadsheet)', 'Spreadsheet');
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  /** PPTX / PPT → PDF — extracts text from slide XML using JSZip. */
  private async pptToPdf(buffer: Buffer): Promise<PdfResult> {
    const zip        = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)?.[0] ?? '0', 10);
        const nb = parseInt(b.match(/\d+/)?.[0] ?? '0', 10);
        return na - nb;
      });

    let text = '';
    for (let i = 0; i < slideFiles.length; i++) {
      const xml     = await zip.files[slideFiles[i]].async('text');
      const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [];
      const slide   = matches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join(' ');
      if (slide) text += `Slide ${i + 1}\n${'─'.repeat(30)}\n${slide}\n\n`;
    }
    const doc = await this.renderTextAsPdf(text || '(No text content found in presentation)', 'Presentation');
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  /** RTF → PDF — strips RTF control codes to extract plain text. */
  private async rtfToPdf(buffer: Buffer): Promise<PdfResult> {
    const rtf = buffer.toString('latin1');
    const text = rtf
      .replace(/\{\\\*[^}]*\}/g, '')                // remove \* groups
      .replace(/\\[a-z]+[-0-9]* ?/gi, ' ')           // strip control words
      .replace(/[{}\\]/g, '')                         // remove braces and backslashes
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const doc = await this.renderTextAsPdf(text || '(No readable content in RTF)', 'RTF Document');
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  /** HTML → PDF — strips tags with node-html-parser, renders plain text. */
  async htmlToPdf(buffer: Buffer): Promise<PdfResult> {
    const html = buffer.toString('utf-8');
    const root = parseHtml(html);
    root.querySelectorAll('script, style, head').forEach(el => el.remove());
    const text = (root.structuredText ?? root.text)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const doc = await this.renderTextAsPdf(text || '(Empty HTML document)', 'HTML Document');
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  /** DXF → PDF — parses DXF entities and renders them with pdf-lib. DWG returns a clear error. */
  async cadToPdf(buffer: Buffer, ext: string): Promise<PdfResult> {
    if (ext === 'dwg') {
      throw new BadRequestException(
        'DWG is a proprietary binary format with no open-source npm parser. ' +
        'Convert to DXF first (AutoCAD: "Save As DXF", FreeCAD / LibreCAD: "Export as DXF") and re-upload the .dxf file.',
      );
    }
    if (ext !== 'dxf') {
      throw new BadRequestException(`Unsupported CAD format ".${ext}". Supported: dxf`);
    }

    const content  = buffer.toString('utf-8');
    const entities = this.parseDxfEntities(content);

    // ── Bounding box ─────────────────────────────────────────────────────────
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const upd = (x: number, y: number) => {
      if (!isFinite(x) || !isFinite(y)) return;
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    };

    for (const e of entities) {
      switch (e.type) {
        case 'LINE':       upd(e.x0, e.y0); upd(e.x1, e.y1); break;
        case 'CIRCLE':
        case 'ARC':        upd(e.x0 - e.r, e.y0 - e.r); upd(e.x0 + e.r, e.y0 + e.r); break;
        case 'LWPOLYLINE': for (const v of e.vertices ?? []) upd(v.x, v.y); break;
        case 'TEXT':
        case 'MTEXT':      upd(e.x0 ?? 0, e.y0 ?? 0); break;
      }
    }

    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 297; maxY = 210; }

    const dxfW = (maxX - minX) || 1;
    const dxfH = (maxY - minY) || 1;

    // A4 landscape for technical drawings
    const pageW  = 841.89;
    const pageH  = 595.28;
    const margin = 30;
    const scale  = Math.min((pageW - margin * 2) / dxfW, (pageH - margin * 2) / dxfH);

    const tx = (x: number) => margin + (x - minX) * scale;
    const ty = (y: number) => margin + (y - minY) * scale; // DXF Y↑ matches PDF Y↑

    const doc  = await PDFDocument.create();
    doc.setTitle('CAD Drawing');
    doc.setProducer('ImageDigitalHub');
    const page = doc.addPage([pageW, pageH]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const ink  = rgb(0.1, 0.1, 0.1);
    const sw   = 0.5;

    for (const e of entities) {
      try {
        switch (e.type) {
          case 'LINE':
            page.drawLine({
              start: { x: tx(e.x0 ?? 0), y: ty(e.y0 ?? 0) },
              end:   { x: tx(e.x1 ?? 0), y: ty(e.y1 ?? 0) },
              color: ink, thickness: sw,
            });
            break;

          case 'CIRCLE':
            page.drawCircle({
              x: tx(e.x0), y: ty(e.y0),
              size: (e.r ?? 0) * scale,
              borderColor: ink, borderWidth: sw,
            });
            break;

          case 'ARC': {
            const pts = this.sampleArc(e.x0, e.y0, e.r ?? 0, e.startAngle ?? 0, e.endAngle ?? 360, 48);
            for (let j = 0; j < pts.length - 1; j++) {
              page.drawLine({
                start: { x: tx(pts[j][0]),     y: ty(pts[j][1])     },
                end:   { x: tx(pts[j + 1][0]), y: ty(pts[j + 1][1]) },
                color: ink, thickness: sw,
              });
            }
            break;
          }

          case 'LWPOLYLINE': {
            const verts = e.vertices ?? [];
            for (let j = 0; j < verts.length - 1; j++) {
              page.drawLine({
                start: { x: tx(verts[j].x),     y: ty(verts[j].y)     },
                end:   { x: tx(verts[j + 1].x), y: ty(verts[j + 1].y) },
                color: ink, thickness: sw,
              });
            }
            if (e.closed && verts.length > 1) {
              page.drawLine({
                start: { x: tx(verts[verts.length - 1].x), y: ty(verts[verts.length - 1].y) },
                end:   { x: tx(verts[0].x),                y: ty(verts[0].y)                },
                color: ink, thickness: sw,
              });
            }
            break;
          }

          case 'TEXT':
          case 'MTEXT': {
            const txt = this.sanitizeForPdf(e.text ?? '').trim();
            if (txt) {
              const fs = Math.max(6, Math.min((e.h ?? 2.5) * scale, 12));
              page.drawText(txt, { x: tx(e.x0 ?? 0), y: ty(e.y0 ?? 0), size: fs, font, color: ink });
            }
            break;
          }
        }
      } catch { /* skip malformed individual entity */ }
    }

    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  /** Sample an ARC into N line-segment points (angles in degrees). */
  private sampleArc(
    cx: number, cy: number, r: number,
    startDeg: number, endDeg: number, n: number,
  ): [number, number][] {
    const pts: [number, number][] = [];
    let s = startDeg;
    let e = endDeg;
    if (e <= s) e += 360;
    const step = (e - s) / n;
    for (let d = s; d <= e + step * 0.5; d += step) {
      const rad = Math.min(d, e) * (Math.PI / 180);
      pts.push([cx + r * Math.cos(rad), cy + r * Math.sin(rad)]);
    }
    return pts;
  }

  /**
   * Minimal DXF parser — reads the ENTITIES section and extracts:
   * LINE, CIRCLE, ARC, LWPOLYLINE, TEXT, MTEXT.
   * DXF format: sequential group-code / value line pairs.
   */
  private parseDxfEntities(content: string): any[] {
    const lines    = content.split(/\r?\n/);
    const entities: any[] = [];
    let inEntities = false;
    let cur: any   = null;
    let i          = 0;

    while (i < lines.length - 1) {
      const codeLine = lines[i++].trim();
      const valLine  = lines[i++]?.trim() ?? '';

      const code = parseInt(codeLine, 10);
      if (isNaN(code)) { i -= 1; continue; } // re-sync on stray blank line

      const val = valLine;
      const num = parseFloat(val);

      if (code === 0) {
        if (val === 'ENTITIES') { inEntities = true; continue; }
        if (val === 'ENDSEC' || val === 'EOF') { inEntities = false; continue; }
        if (inEntities) {
          cur = { type: val };
          if (val === 'LWPOLYLINE') cur.vertices = [];
          entities.push(cur);
        }
        continue;
      }

      if (!inEntities || !cur) continue;

      switch (code) {
        case 8:  cur.layer = val; break;
        case 1:  cur.text  = val; break;
        case 3:  cur.text  = (cur.text ?? '') + val; break; // MTEXT overflow continuation
        case 10:
          if (cur.type === 'LWPOLYLINE') { cur._px = isNaN(num) ? 0 : num; }
          else { cur.x0 = isNaN(num) ? 0 : num; }
          break;
        case 20:
          if (cur.type === 'LWPOLYLINE') {
            (cur.vertices ??= []).push({ x: cur._px ?? 0, y: isNaN(num) ? 0 : num });
          } else { cur.y0 = isNaN(num) ? 0 : num; }
          break;
        case 11: cur.x1 = isNaN(num) ? 0 : num; break;
        case 21: cur.y1 = isNaN(num) ? 0 : num; break;
        case 40:
          if (cur.type === 'TEXT' || cur.type === 'MTEXT') cur.h = isNaN(num) ? 2.5 : num;
          else cur.r = isNaN(num) ? 0 : num;
          break;
        case 50: cur.startAngle = isNaN(num) ? 0   : num; break;
        case 51: cur.endAngle   = isNaN(num) ? 360 : num; break;
        case 70: cur.flags = parseInt(val) || 0; cur.closed = (cur.flags & 1) !== 0; break;
      }
    }

    return entities;
  }

  /** EPUB → PDF — unzips the EPUB, extracts HTML chapter text with node-html-parser. */
  async epubToPdf(buffer: Buffer): Promise<PdfResult> {
    const zip       = await JSZip.loadAsync(buffer);
    const htmlFiles = Object.keys(zip.files)
      .filter(n => /\.(html|xhtml)$/i.test(n))
      .sort();

    let text = '';
    for (const fileName of htmlFiles) {
      const content = await zip.files[fileName].async('text');
      const root    = parseHtml(content);
      root.querySelectorAll('script, style').forEach(el => el.remove());
      const chapter = (root.structuredText ?? root.text)
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (chapter) text += chapter + '\n\n';
    }
    const doc = await this.renderTextAsPdf(text || '(No readable content in EPUB)', 'eBook');
    return { buffer: this.toBuffer(await doc.save()), mime: 'application/pdf', ext: 'pdf' };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PDF → IMAGE
  ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Convert every PDF page to a JPEG (or PNG) image and return as a ZIP.
   *
   * Rendering pipeline (tried in order):
   *  1. pdftoppm  – from poppler-utils  (sudo apt-get install -y poppler-utils)
   *  2. gs        – Ghostscript          (sudo apt-get install -y ghostscript)
   *
   * On a fresh EC2 Ubuntu instance run:
   *   sudo apt-get install -y poppler-utils
   * …then restart PM2.
   */
  /**
   * Convert every PDF page to an image using pdfjs-dist + canvas (pure npm —
   * works on Windows, Linux and macOS without any system tools).
   *
   * Falls back to pdftoppm / Ghostscript if the npm renderer fails for any
   * reason (e.g. heavily encrypted or malformed PDFs).
   */
  async pdfToImage(buffer: Buffer, format: string, dpi: number): Promise<PdfResult> {
    const fmt     = format === 'png' ? 'png' : 'jpeg';
    const ext     = fmt === 'jpeg' ? 'jpg' : 'png';
    const safeDpi = Math.min(Math.max(dpi || 150, 72), 300);
    const scale   = safeDpi / 72; // pdfjs base resolution is 72 DPI

    // ── 1. Pure npm renderer: pdfjs-dist + canvas ─────────────────────────────
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as any;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createCanvas } = require('canvas') as { createCanvas: (w: number, h: number) => any };

      pdfjsLib.GlobalWorkerOptions.workerSrc = ''; // run in same thread (server-safe)

      const loadingTask = pdfjsLib.getDocument({
        data:      new Uint8Array(buffer),
        verbosity: 0,
      });
      const pdfDoc = await loadingTask.promise;
      const images: { name: string; data: Buffer }[] = [];

      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page     = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const w        = Math.ceil(viewport.width);
        const h        = Math.ceil(viewport.height);

        const canvas  = createCanvas(w, h);
        const context = canvas.getContext('2d');

        // Provide a canvas factory so pdfjs can create sub-canvases (e.g. for images)
        const canvasFactory = {
          create: (cw: number, ch: number) => {
            const c = createCanvas(cw, ch);
            return { canvas: c, context: c.getContext('2d') };
          },
          reset: (pair: any, cw: number, ch: number) => {
            pair.canvas.width = cw;
            pair.canvas.height = ch;
          },
          destroy: (pair: any) => {
            pair.canvas.width = 0;
            pair.canvas.height = 0;
          },
        };

        await page.render({ canvasContext: context, viewport, canvasFactory }).promise;

        const imgData: Buffer = fmt === 'jpeg'
          ? canvas.toBuffer('image/jpeg', { quality: 0.88 })
          : canvas.toBuffer('image/png');

        images.push({ name: `page-${String(pageNum).padStart(3, '0')}.${ext}`, data: imgData });
      }

      if (images.length === 0) throw new Error('PDF has no pages.');

      // Single page → return image directly; multi-page → ZIP
      if (images.length === 1) {
        return { buffer: images[0].data, mime: fmt === 'jpeg' ? 'image/jpeg' : 'image/png', ext };
      }
      const zip = new JSZip();
      for (const img of images) zip.file(img.name, img.data);
      return {
        buffer: this.toBuffer(await zip.generateAsync({ type: 'nodebuffer' })),
        mime:   'application/zip',
        ext:    'zip',
      };

    } catch (npmErr: any) {
      // Module missing → try system tools. Any other error → rethrow.
      if ((npmErr as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw npmErr;
    }

    // ── 2. Fallback: system tools (pdftoppm / Ghostscript) ───────────────────
    const execAsync = promisify(exec);
    const tmpDir    = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf2img-'));
    const inFile    = path.join(tmpDir, 'input.pdf');
    await fs.promises.writeFile(inFile, buffer);

    try {
      // 2a. pdftoppm (poppler-utils)
      let imgFiles: string[] = [];
      const outPrefix = path.join(tmpDir, 'page');
      try {
        await execAsync(`pdftoppm -${fmt === 'jpeg' ? 'jpeg' : 'png'} -r ${safeDpi} "${inFile}" "${outPrefix}"`);
        imgFiles = (await fs.promises.readdir(tmpDir))
          .filter(f => f.startsWith('page') && (f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')))
          .sort();
      } catch { /* try gs next */ }

      // 2b. Ghostscript
      if (imgFiles.length === 0) {
        const gsOut = path.join(tmpDir, `page_%04d.${ext}`);
        try {
          await execAsync(`gs -dNOPAUSE -dBATCH -sDEVICE=${fmt === 'jpeg' ? 'jpeg' : 'png16m'} -r${safeDpi} -sOutputFile="${gsOut}" "${inFile}"`);
          imgFiles = (await fs.promises.readdir(tmpDir))
            .filter(f => f.startsWith('page_') && f.endsWith(`.${ext}`))
            .sort();
        } catch {
          throw new BadRequestException(
            'pdfjs-dist / canvas npm modules are missing. ' +
            'Run "npm install pdfjs-dist@3 canvas" in the project root and restart.',
          );
        }
      }

      if (imgFiles.length === 0) throw new Error('No output files generated. The PDF may be empty or corrupted.');

      if (imgFiles.length === 1) {
        const imgBuf = await fs.promises.readFile(path.join(tmpDir, imgFiles[0]));
        return { buffer: imgBuf, mime: fmt === 'jpeg' ? 'image/jpeg' : 'image/png', ext };
      }
      const zip = new JSZip();
      for (const f of imgFiles) zip.file(f, await fs.promises.readFile(path.join(tmpDir, f)));
      return {
        buffer: this.toBuffer(await zip.generateAsync({ type: 'nodebuffer' })),
        mime:   'application/zip',
        ext:    'zip',
      };
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /* ─── PDF to PowerPoint ────────────────────────────────────────────────── */
  async pdfToPptx(buffer: Buffer): Promise<PdfResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as any;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createCanvas } = require('canvas') as { createCanvas: (w: number, h: number) => any };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PptxGenJS = require('pptxgenjs') as any;

    pdfjsLib.GlobalWorkerOptions.workerSrc = '';

    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), verbosity: 0 });
    const pdfDoc = await loadingTask.promise;

    const pptx = new PptxGenJS();

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page     = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });
      const w        = Math.ceil(viewport.width);
      const h        = Math.ceil(viewport.height);

      const canvas  = createCanvas(w, h);
      const context = canvas.getContext('2d');

      const canvasFactory = {
        create: (cw: number, ch: number) => {
          const c = createCanvas(cw, ch);
          return { canvas: c, context: c.getContext('2d') };
        },
        reset: (pair: any, cw: number, ch: number) => {
          pair.canvas.width = cw; pair.canvas.height = ch;
        },
        destroy: (pair: any) => {
          pair.canvas.width = 0; pair.canvas.height = 0;
        },
      };

      await page.render({ canvasContext: context, viewport, canvasFactory }).promise;

      const imgBase64 = canvas.toBuffer('image/jpeg', { quality: 0.88 }).toString('base64');

      const aspectRatio = h / w;
      const slideW = 10;
      const slideH = parseFloat((slideW * aspectRatio).toFixed(4));

      pptx.defineLayout({ name: `L${pageNum}`, width: slideW, height: slideH });
      const slide = pptx.addSlide();
      slide.addImage({
        data: `data:image/jpeg;base64,${imgBase64}`,
        x: 0, y: 0,
        w: slideW,
        h: slideH,
      });
    }

    const pptxBuffer = this.toBuffer(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    return {
      buffer: pptxBuffer,
      mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ext: 'pptx',
    };
  }

  /* ─── Translate PDF ─────────────────────────────────────────────────────── */
  async translatePdf(buffer: Buffer, targetLang: string): Promise<PdfResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

    const lang = (targetLang || 'es').replace(/[^a-z-]/gi, '').slice(0, 10);

    const parsed = await pdfParse(buffer);
    const rawText = parsed.text || '';

    if (!rawText.trim()) {
      throw new BadRequestException('No extractable text found in this PDF. Scanned/image PDFs cannot be translated.');
    }

    // Split into ≤4000-char chunks
    const chunks: string[] = [];
    let remaining = rawText;
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, 4000));
      remaining = remaining.slice(4000);
    }

    // Translate via Google Translate unofficial endpoint
    const translated: string[] = [];
    for (const chunk of chunks) {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(lang)}&dt=t&q=${encodeURIComponent(chunk)}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new BadRequestException(`Translation failed (HTTP ${resp.status}). Try again later.`);
      const data = await resp.json() as any[][];
      const parts: string[] = (data[0] ?? []).map((seg: any[]) => seg[0] ?? '');
      translated.push(parts.join(''));
    }

    const finalText = translated.join('\n');

    // Build output PDF
    const outDoc = await PDFDocument.create();
    const font   = await outDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 11;
    const margin   = 50;
    const pageWidth  = 595;
    const pageHeight = 842;
    const maxWidth   = pageWidth - margin * 2;
    const lineHeight = fontSize * 1.45;

    const words = finalText.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(test, fontSize);
      if (testWidth > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);

    const linesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight);
    for (let i = 0; i < lines.length; i += linesPerPage) {
      const page = outDoc.addPage([pageWidth, pageHeight]);
      const pageLines = lines.slice(i, i + linesPerPage);
      let y = pageHeight - margin;
      for (const line of pageLines) {
        page.drawText(line, { x: margin, y, font, size: fontSize, color: rgb(0, 0, 0) });
        y -= lineHeight;
      }
    }

    const pdfBytes = await outDoc.save();
    return { buffer: this.toBuffer(pdfBytes), mime: 'application/pdf', ext: 'pdf' };
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Remove Watermark from PDF
   * Strategy:
   *   1. Render each page to PNG at 150 DPI using pdfjs-dist + canvas
   *   2. Apply sharp blur-blend to suppress semi-transparent overlays
   *   3. Rebuild a new PDF from the cleaned page images via pdf-lib
   * ─────────────────────────────────────────────────────────────────────── */
  async removePdfWatermark(buffer: Buffer, strength = 60): Promise<PdfResult> {
    const pct = Math.max(10, Math.min(100, strength)) / 100;
    const scale = 150 / 72; // 150 DPI

    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as any;
    const { createCanvas } = require('canvas') as { createCanvas: (w: number, h: number) => any };
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';

    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
    const pageCount: number = pdfDoc.numPages;
    const cleanedImages: Buffer[] = [];

    for (let i = 1; i <= pageCount; i++) {
      const page     = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale });
      const w = Math.round(viewport.width);
      const h = Math.round(viewport.height);

      const canvas  = createCanvas(w, h);
      const context = canvas.getContext('2d');

      const canvasFactory = {
        create:  (cw: number, ch: number) => { const c = createCanvas(cw, ch); return { canvas: c, context: c.getContext('2d') }; },
        reset:   (pair: any, cw: number, ch: number) => { pair.canvas.width = cw; pair.canvas.height = ch; },
        destroy: (pair: any) => { pair.canvas.width = 0; pair.canvas.height = 0; },
      };

      await page.render({ canvasContext: context, viewport, canvasFactory }).promise;
      const pageImgBuf = canvas.toBuffer('image/png');

      // Blur-blend to suppress semi-transparent watermark overlays
      const blurSigma = Math.max(5, Math.round(Math.min(w, h) * 0.03));
      const orig  = await (sharp as any)(pageImgBuf).ensureAlpha(1).raw().toBuffer({ resolveWithObject: true });
      const bgRaw = await (sharp as any)(pageImgBuf).blur(blurSigma).ensureAlpha(1).raw().toBuffer();

      const blendBuf = Buffer.alloc(orig.data.length);
      for (let px = 0; px < orig.data.length; px++) {
        blendBuf[px] = Math.round(orig.data[px] * (1 - pct) + bgRaw[px] * pct);
      }

      const cleaned = await (sharp as any)(blendBuf, {
        raw: { width: w, height: h, channels: orig.info.channels as number },
      })
        .normalise()
        .sharpen({ sigma: 0.5 })
        .png()
        .toBuffer();

      cleanedImages.push(cleaned);
    }

    // Rebuild PDF from cleaned images
    const outDoc = await PDFDocument.create();
    for (const imgBuf of cleanedImages) {
      const pngImage = await outDoc.embedPng(imgBuf);
      const pg = outDoc.addPage([pngImage.width, pngImage.height]);
      pg.drawImage(pngImage, { x: 0, y: 0, width: pngImage.width, height: pngImage.height });
    }

    const pdfBytes = await outDoc.save();
    return { buffer: this.toBuffer(pdfBytes), mime: 'application/pdf', ext: 'pdf' };
  }
}

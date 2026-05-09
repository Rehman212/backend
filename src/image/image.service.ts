import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';

export interface ImageResult {
  buffer: Buffer;
  mime: string;
  ext: string;
}

@Injectable()
export class ImageService {
  constructor(private readonly config: ConfigService) {}

  /* ─── Helpers ──────────────────────────────────────────────────────────── */

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const h = (hex || '#ffffff').replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16) || 255,
      g: parseInt(h.substring(2, 4), 16) || 255,
      b: parseInt(h.substring(4, 6), 16) || 255,
    };
  }

  private escapeXml(text: string): string {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }


  private send(buffer: Buffer, mime: string, ext: string): ImageResult {
    return { buffer, mime, ext };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     I.  DIGITAL IMAGE CONVERSIONS
  ═══════════════════════════════════════════════════════════════════════ */

  /** Standardize .jpg / .jpeg extension — just re-encodes to JPEG */
  async jpgJpegUpdate(
    buffer: Buffer,
    outputExtension = 'jpg',
  ): Promise<ImageResult> {
    const out = await (sharp)(buffer).jpeg({ quality: 95 }).toBuffer();
    return this.send(out, 'image/jpeg', outputExtension === 'jpeg' ? 'jpeg' : 'jpg');
  }

  /** JPG → PNG */
  async jpgToPng(buffer: Buffer): Promise<ImageResult> {
    const out = await (sharp)(buffer).png().toBuffer();
    return this.send(out, 'image/png', 'png');
  }

  /** PNG → JPG (fills transparent areas with solid background) */
  async pngToJpg(
    buffer: Buffer,
    backgroundColor = '#ffffff',
    quality = 90,
  ): Promise<ImageResult> {
    const bg = this.hexToRgb(backgroundColor);
    const out = await (sharp)(buffer)
      .flatten({ background: bg })
      .jpeg({ quality })
      .toBuffer();
    return this.send(out, 'image/jpeg', 'jpg');
  }

  /** Universal format converter */
  async convertFormat(
    buffer: Buffer,
    outputFormat: string,
  ): Promise<ImageResult> {
    const map: Record<string, { sharpFmt: string; mime: string }> = {
      png:  { sharpFmt: 'png',  mime: 'image/png'   },
      jpg:  { sharpFmt: 'jpeg', mime: 'image/jpeg'  },
      jpeg: { sharpFmt: 'jpeg', mime: 'image/jpeg'  },
      bmp:  { sharpFmt: 'bmp',  mime: 'image/bmp'   },
      tiff: { sharpFmt: 'tiff', mime: 'image/tiff'  },
      avif: { sharpFmt: 'avif', mime: 'image/avif'  },
      gif:  { sharpFmt: 'gif',  mime: 'image/gif'   },
      webp: { sharpFmt: 'webp', mime: 'image/webp'  },
      ico:  { sharpFmt: 'png',  mime: 'image/x-icon' },
    };
    const target = map[outputFormat] ?? map['png'];
    const out = await (sharp)(buffer)
      .toFormat(target.sharpFmt as any)
      .toBuffer();
    return this.send(out, target.mime, outputFormat);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     II-A.  SIZING & DIMENSIONS
  ═══════════════════════════════════════════════════════════════════════ */

  /** Compress image with quality control */
  async compress(
    buffer: Buffer,
    quality = 75,
    outputFormat = 'jpg',
  ): Promise<ImageResult> {
    const q = Math.max(1, Math.min(100, quality));
    if (outputFormat === 'webp') {
      const out = await (sharp)(buffer).webp({ quality: q }).toBuffer();
      return this.send(out, 'image/webp', 'webp');
    }
    if (outputFormat === 'png') {
      const level = Math.round((100 - q) / 11);
      const out = await (sharp)(buffer)
        .png({ compressionLevel: level })
        .toBuffer();
      return this.send(out, 'image/png', 'png');
    }
    const out = await (sharp)(buffer).jpeg({ quality: q }).toBuffer();
    return this.send(out, 'image/jpeg', 'jpg');
  }

  /** Resize to exact dimensions with fit strategy */
  async resize(
    buffer: Buffer,
    width: number,
    height: number,
    fit = 'cover',
  ): Promise<ImageResult> {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const out = await (sharp)(buffer)
      .resize(w, h, { fit: fit as any, withoutEnlargement: false })
      .jpeg({ quality: 90 })
      .toBuffer();
    return this.send(out, 'image/jpeg', 'jpg');
  }

  /** Crop to specified region */
  async crop(
    buffer: Buffer,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<ImageResult> {
    const meta = await (sharp)(buffer).metadata();
    const imgW = meta.width as number;
    const imgH = meta.height as number;
    const left   = Math.max(0, Math.round(x));
    const top    = Math.max(0, Math.round(y));
    const cropW  = Math.min(Math.round(width),  imgW - left);
    const cropH  = Math.min(Math.round(height), imgH - top);
    if (cropW <= 0 || cropH <= 0)
      throw new BadRequestException('Crop region is outside image bounds.');
    const out = await (sharp)(buffer)
      .extract({ left, top, width: cropW, height: cropH })
      .jpeg({ quality: 92 })
      .toBuffer();
    return this.send(out, 'image/jpeg', 'jpg');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     II-B.  ENHANCEMENTS
  ═══════════════════════════════════════════════════════════════════════ */

  /** AI-grade upscaling via Lanczos3 resampling */
  async aiUpscale(buffer: Buffer, scale = 2): Promise<ImageResult> {
    const s = Math.max(2, Math.min(8, scale));
    const meta = await (sharp)(buffer).metadata();
    const newW = Math.round((meta.width as number) * s);
    const newH = Math.round((meta.height as number) * s);
    const out = await (sharp)(buffer)
      .resize(newW, newH, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
    return this.send(out, 'image/png', 'png');
  }

  /** Sharpen / unblur a blurry image */
  async unblur(buffer: Buffer, strength = 5): Promise<ImageResult> {
    const sigma = Math.max(0.5, Math.min(10, strength) * 0.4);
    const out = await (sharp)(buffer)
      .sharpen({ sigma, m1: 0.5, m2: 0.8 })
      .jpeg({ quality: 92 })
      .toBuffer();
    return this.send(out, 'image/jpeg', 'jpg');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     II-C.  VISUAL EFFECTS
  ═══════════════════════════════════════════════════════════════════════ */

  /** Apply Gaussian / box blur */
  async blur(
    buffer: Buffer,
    radius = 10,
  ): Promise<ImageResult> {
    const r = Math.max(0.3, Math.min(1000, radius));
    const out = await (sharp)(buffer)
      .blur(r)
      .jpeg({ quality: 90 })
      .toBuffer();
    return this.send(out, 'image/jpeg', 'jpg');
  }

  /** Rotate 90 / 180 / 270 or custom angle */
  async rotate(
    buffer: Buffer,
    angle: string,
    customAngle = 45,
    background = '#ffffff',
  ): Promise<ImageResult> {
    const deg =
      angle === 'custom' ? customAngle : parseInt(angle as string, 10) || 90;
    const bg = this.hexToRgb(background);
    const out = await (sharp)(buffer)
      .rotate(deg, { background: { ...bg, alpha: 1 } })
      .jpeg({ quality: 92 })
      .toBuffer();
    return this.send(out, 'image/jpeg', 'jpg');
  }

  /** Flip horizontally / vertically and apply custom tilt */
  async tiltFlip(
    buffer: Buffer,
    flip = 'horizontal',
    tilt = 0,
    background = '#ffffff',
  ): Promise<ImageResult> {
    const bg = this.hexToRgb(background);
    let pipe = (sharp)(buffer);
    if (flip === 'horizontal' || flip === 'both') pipe = pipe.flop();
    if (flip === 'vertical'   || flip === 'both') pipe = pipe.flip();
    if (tilt !== 0)
      pipe = pipe.rotate(tilt, { background: { ...bg, alpha: 1 } });
    const out = await pipe.jpeg({ quality: 92 }).toBuffer();
    return this.send(out, 'image/jpeg', 'jpg');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     II-D.  CONTENT EDITING
  ═══════════════════════════════════════════════════════════════════════ */

  /** Add text watermark via SVG composite */
  async addWatermark(
    buffer: Buffer,
    text: string,
    position = 'bottom-right',
    fontSize = 24,
    opacity = 60,
    color = '#ffffff',
    rotation = 0,
  ): Promise<ImageResult> {
    const meta = await (sharp)(buffer).metadata();
    const w = (meta.width  as number) || 800;
    const h = (meta.height as number) || 600;
    const pad = fontSize;
    const opStr = (Math.max(0, Math.min(100, opacity)) / 100).toFixed(2);

    const positions: Record<string, { x: number; y: number; anchor: string }> = {
      'center':       { x: w / 2,          y: h / 2,         anchor: 'middle' },
      'top-left':     { x: pad,             y: pad + fontSize, anchor: 'start'  },
      'top-right':    { x: w - pad,         y: pad + fontSize, anchor: 'end'    },
      'bottom-left':  { x: pad,             y: h - pad,        anchor: 'start'  },
      'bottom-right': { x: w - pad,         y: h - pad,        anchor: 'end'    },
    };
    const pos = positions[position] ?? positions['bottom-right'];

    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <text
    x="${pos.x}" y="${pos.y}"
    text-anchor="${pos.anchor}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${fontSize}px"
    font-weight="bold"
    fill="${color}"
    opacity="${opStr}"
    transform="rotate(${rotation},${pos.x},${pos.y})"
  >${this.escapeXml(text)}</text>
</svg>`);

    const out = await (sharp)(buffer)
      .composite([{ input: svg, top: 0, left: 0 }])
      .jpeg({ quality: 92 })
      .toBuffer();
    return this.send(out, 'image/jpeg', 'jpg');
  }

  /** Meme generator — Impact-style text top and bottom */
  async memeGenerator(
    buffer: Buffer,
    topText: string,
    bottomText: string,
    fontSize = 36,
    textColor = '#ffffff',
    strokeColor = '#000000',
  ): Promise<ImageResult> {
    const meta = await (sharp)(buffer).metadata();
    const w  = (meta.width  as number) || 800;
    const h  = (meta.height as number) || 600;
    const sw = Math.max(1, Math.round(fontSize / 18));
    const pad = Math.round(fontSize * 0.2);

    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  ${topText ? `<text x="${w / 2}" y="${fontSize + pad}"
    text-anchor="middle"
    font-family="Impact, Arial Black, Arial, sans-serif"
    font-size="${fontSize}px" font-weight="900"
    fill="${textColor}" stroke="${strokeColor}" stroke-width="${sw}px"
    paint-order="stroke"
  >${this.escapeXml(topText.toUpperCase())}</text>` : ''}
  ${bottomText ? `<text x="${w / 2}" y="${h - pad}"
    text-anchor="middle"
    font-family="Impact, Arial Black, Arial, sans-serif"
    font-size="${fontSize}px" font-weight="900"
    fill="${textColor}" stroke="${strokeColor}" stroke-width="${sw}px"
    paint-order="stroke"
  >${this.escapeXml(bottomText.toUpperCase())}</text>` : ''}
</svg>`);

    const out = await (sharp)(buffer)
      .composite([{ input: svg, top: 0, left: 0 }])
      .jpeg({ quality: 92 })
      .toBuffer();
    return this.send(out, 'image/jpeg', 'jpg');
  }

  /** Full photo editor — brightness / contrast / saturation / hue / sharpness / filter */
  async photoEditor(
    buffer: Buffer,
    brightness = 0,
    contrast   = 0,
    saturation = 0,
    hue        = 0,
    sharpness  = 0,
    filter     = 'none',
  ): Promise<ImageResult> {
    let pipe = (sharp)(buffer);

    /* Artistic filter */
    if (filter === 'grayscale') {
      pipe = pipe.greyscale();
    } else if (filter === 'sepia') {
      pipe = pipe.greyscale().tint({ r: 112, g: 66, b: 20 });
    } else if (filter === 'invert') {
      pipe = pipe.negate();
    } else if (filter === 'cool') {
      pipe = pipe.tint({ r: 180, g: 210, b: 255 });
    } else if (filter === 'warm') {
      pipe = pipe.tint({ r: 255, g: 210, b: 160 });
    } else if (filter === 'vivid') {
      pipe = pipe.modulate({ saturation: 1.8 });
    } else if (filter === 'vintage') {
      pipe = pipe
        .greyscale()
        .tint({ r: 255, g: 220, b: 180 })
        .modulate({ brightness: 0.9 });
    }

    /* Modulate (brightness / saturation / hue) */
    const bm = 1 + brightness / 100;
    const sm = 1 + saturation / 100;
    if (brightness !== 0 || saturation !== 0 || hue !== 0) {
      pipe = pipe.modulate({
        brightness: Math.max(0.01, bm),
        saturation: Math.max(0.01, sm),
        hue,
      });
    }

    /* Contrast via linear transform: output = a*input + b  (centred at 128) */
    if (contrast !== 0) {
      const a = 1 + contrast / 100;
      const b = Math.round(128 * (1 - a));
      pipe = pipe.linear(a, b);
    }

    /* Sharpness */
    if (sharpness > 0) {
      pipe = pipe.sharpen({ sigma: sharpness * 0.3 });
    }

    const out = await pipe.jpeg({ quality: 92 }).toBuffer();
    return this.send(out, 'image/jpeg', 'jpg');
  }

  async removeBackground(imageBuffer: Buffer): Promise<ImageResult> {
    const apiKey = this.config.get<string>('REMOVE_BG_API_KEY');
    if (!apiKey) throw new BadRequestException('REMOVE_BG_API_KEY is not set in environment.');

    // Build multipart form
    const form = new FormData();
    const ab = imageBuffer.buffer.slice(
      imageBuffer.byteOffset,
      imageBuffer.byteOffset + imageBuffer.byteLength,
    ) as ArrayBuffer;
    form.append('image_file', new Blob([ab], { type: 'image/jpeg' }), 'image.jpg');
    form.append('size', 'auto');

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: form,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new BadRequestException(`remove.bg API error ${response.status}: ${errText}`);
    }

    const outBuffer = Buffer.from(await response.arrayBuffer());
    return this.send(outBuffer, 'image/png', 'png');
  }

  async htmlToImage(opts: {
    html?:   string;   // raw HTML string from uploaded file
    url?:    string;   // public URL to screenshot
    format:  'png' | 'jpeg' | 'webp';
    width:   number;
    height?: number;   // if omitted → full-page height
    quality: number;   // 1-100, jpeg/webp only
  }): Promise<ImageResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const puppeteer = require('puppeteer') as typeof import('puppeteer');

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: opts.width, height: opts.height ?? 768 });

      if (opts.url) {
        await page.goto(opts.url, { waitUntil: 'networkidle2', timeout: 30000 });
      } else if (opts.html) {
        await page.setContent(opts.html, { waitUntil: 'networkidle0' });
      }

      const screenshotOpts: any = {
        type:     opts.format,
        fullPage: !opts.height,  // full-page when no explicit height given
      };
      if (opts.format !== 'png') screenshotOpts.quality = opts.quality;

      const imgBuffer = Buffer.from(await page.screenshot(screenshotOpts) as unknown as Uint8Array);

      const mimeMap: Record<string, string> = {
        png:  'image/png',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
      };
      return this.send(imgBuffer, mimeMap[opts.format], opts.format);
    } finally {
      await browser.close();
    }
  }
}

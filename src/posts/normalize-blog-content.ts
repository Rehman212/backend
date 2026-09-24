/**
 * SEO heading rules for blog body (page title is already the only <h1>):
 * - Long fake headings → <p>
 * - Real section headings cycle H2 → H3 → H4 → H2… (not all H2)
 */
export function stripHtmlText(html: string): string {
  return (html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function looksLikeParagraph(innerHtml: string): boolean {
  const text = stripHtmlText(innerHtml);
  if (!text) return false;
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words >= 18) return true;
  if (text.length >= 140) return true;
  if (words >= 12 && /[.!]$/.test(text)) return true;
  return false;
}

const HEADING_CYCLE = ['h2', 'h3', 'h4'] as const;

export function normalizeBlogContent(html: string): string {
  if (!html) return '';

  let out = html.replace(
    /<(h[1-6])(\b[^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, _tag: string, attrs: string, inner: string) => {
      if (looksLikeParagraph(inner)) {
        return `<p${attrs || ''}>${inner}</p>`;
      }
      return match;
    },
  );

  let index = 0;
  out = out.replace(
    /<(h[1-6])(\b[^>]*)>([\s\S]*?)<\/\1>/gi,
    (_match, _tag: string, attrs: string, inner: string) => {
      const level = HEADING_CYCLE[index % HEADING_CYCLE.length];
      index += 1;
      return `<${level}${attrs || ''}>${inner}</${level}>`;
    },
  );

  return out;
}

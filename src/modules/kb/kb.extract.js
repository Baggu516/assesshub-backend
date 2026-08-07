import path from 'path';
import { createRequire } from 'node:module';
import mammoth from 'mammoth';
import * as cheerio from 'cheerio';
import { readStorageBytes } from '../../utils/s3.js';

const require = createRequire(import.meta.url);
/** Avoid `pdf-parse/index.js` — it runs a debug harness that reads `./test/data/05-versions-space.pdf`. */
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

function normalizeText(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdfText(buf) {
  const result = await pdfParse(buf);
  return normalizeText(result.text);
}

export function detectFileType(originalName, mimeType = '') {
  const ext = path.extname(originalName || '').toLowerCase().replace('.', '');
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (
    ext === 'docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (ext === 'html' || ext === 'htm' || mimeType === 'text/html') return 'html';
  if (ext === 'txt' || mimeType === 'text/plain') return 'txt';
  return null;
}

export async function extractTextFromBuffer(buf, fileType) {
  if (fileType === 'txt') {
    return normalizeText(buf.toString('utf8'));
  }

  if (fileType === 'html') {
    const html = buf.toString('utf8');
    const $ = cheerio.load(html);
    $('script, style, noscript').remove();
    return normalizeText($('body').text() || $.root().text());
  }

  if (fileType === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return normalizeText(value);
  }

  if (fileType === 'pdf') {
    return extractPdfText(buf);
  }

  throw new Error(`Unsupported file type: ${fileType}`);
}

/** Supports local filesystem paths and `s3://bucket/key` refs. */
export async function extractTextFromFile(storagePath, fileType) {
  const buf = await readStorageBytes(storagePath);
  return extractTextFromBuffer(buf, fileType);
}

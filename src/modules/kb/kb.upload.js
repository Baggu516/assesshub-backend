import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { env } from '../../config/env.js';
import { KB_UPLOAD_ROOT } from './kb.service.js';
import { ALLOWED_EXTENSIONS } from './kb.constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = path.join(__dirname, '../../../uploads/tmp');

fs.mkdirSync(tempDir, { recursive: true });
fs.mkdirSync(KB_UPLOAD_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tempDir),
  filename: (_req, file, cb) => {
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`;
    cb(null, safe);
  },
});

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error('Only PDF, DOCX, HTML, and TXT files are allowed'));
  }
  cb(null, true);
}

export const kbUpload = multer({
  storage,
  limits: { fileSize: env.KB_MAX_UPLOAD_BYTES },
  fileFilter,
});

import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { projectUploadsPath } from '../../utils/writableDir.js';
import { ALLOWED_EXTENSIONS } from './kb.constants.js';

const tempDir = projectUploadsPath('tmp');

async function ensureTempDir() {
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureTempDir()
      .then((dir) => cb(null, dir))
      .catch((err) => cb(err));
  },
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
  limits: { fileSize: parseInt(process.env.KB_MAX_UPLOAD_BYTES, 10) },
  fileFilter,
});

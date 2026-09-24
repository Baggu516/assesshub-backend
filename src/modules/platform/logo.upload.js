import multer from 'multer';
import path from 'path';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']);
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif']);

const MAX_LOGO_BYTES = parseInt(process.env.LOGO_MAX_UPLOAD_BYTES || '', 10) || 1 * 1024 * 1024;

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(mime)) {
    return cb(new Error('Logo must be PNG, JPEG, WebP, GIF, or SVG'));
  }
  cb(null, true);
}

/** Memory upload for client logos (uploaded to Supabase/S3). */
export const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
  fileFilter,
});

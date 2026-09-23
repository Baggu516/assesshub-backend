import multer from 'multer';
import path from 'path';

const ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx']);
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const MAX_BYTES = parseInt(process.env.RESOURCE_MAX_UPLOAD_BYTES || '', 10) || 20 * 1024 * 1024;

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  const mimeOk = !mime || mime === 'application/octet-stream' || ALLOWED_MIME.has(mime);
  if (!ALLOWED_EXT.has(ext) || !mimeOk) {
    return cb(new Error('File must be a PDF or Word document (.pdf, .doc, .docx)'));
  }
  cb(null, true);
}

export const resourceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter,
});

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Writable upload path: `/tmp` on Vercel, `backend/uploads` locally. */
export function projectUploadsPath(...segments) {
  if (process.env.VERCEL) {
    return path.join('/tmp', 'assesshub', ...segments);
  }
  return path.join(__dirname, '../../uploads', ...segments);
}

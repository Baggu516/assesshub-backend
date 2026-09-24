import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';

export function errorMiddleware(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
    });
  }

  if (err?.name === 'MulterError' || err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error:
        err.code === 'LIMIT_FILE_SIZE'
          ? err.field === 'logo'
            ? 'Image must be 1MB or smaller'
            : 'File is too large'
          : err.message || 'Upload failed',
    });
  }

  const status = err instanceof AppError ? err.status : err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && err.stack ? { stack: err.stack } : {}),
  });
}

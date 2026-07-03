import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { apiLimiter } from './middleware/rateLimit.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import routes from './routes/index.js';

async function ensureDb(_req, _res, next) {
  try {
    await connectDb();
    next();
  } catch (err) {
    err.status = 503;
    err.message = err.message || 'Database unavailable';
    next(err);
  }
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    })
  );
  app.get('/', (_req, res) => {
    res.json({ ok: true, service: 'assesshub-api' });
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use('/api', ensureDb, apiLimiter, routes);
  app.use(errorMiddleware);
  return app;
}

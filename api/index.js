import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';

loadEnv();

const app = createApp();

/** Vercel serverless entry — export Express app directly (see Vercel Express guide). */
export default app;

import 'dotenv/config';
import { configureDns } from './utils/dns.js';
import { createApp } from './app.js';
import { connectDb } from './config/db.js';

configureDns();

const app = createApp();

async function main() {
  const missing = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'].filter(
    (k) => !process.env[k]
  );
  if (missing.length) {
    const message = `Missing required env: ${missing.join(', ')}`;
    if (process.env.NODE_ENV === 'production') throw new Error(message);
    console.warn(`Warning: ${message}`);
  }

  await connectDb();
  const port = parseInt(process.env.PORT, 10) || 4000;
  const server = app.listen(port, () => {
    console.log(`API listening on port ${port} (${process.env.NODE_ENV})`);
  });
  server.on('error', (err) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(
        `Port ${port} is already in use. Stop the other API process (or run npm run predev), then try again.`
      );
      process.exit(1);
    }
    throw err;
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { loadEnv, env } from './config/env.js';

loadEnv();

const app = createApp();

async function main() {
  await connectDb();
  app.listen(env.PORT, () => {
    console.log(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

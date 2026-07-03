import { createApp } from '../src/app.js';
import { connectDb } from '../src/config/db.js';
import { loadEnv } from '../src/config/env.js';

loadEnv();

const globalState = globalThis;

async function getApp() {
  if (!globalState.__assesshubReady) {
    globalState.__assesshubReady = connectDb().then(() => {
      globalState.__assesshubApp = createApp();
      return globalState.__assesshubApp;
    });
  }
  return globalState.__assesshubReady;
}

export default async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
}

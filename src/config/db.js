import mongoose from 'mongoose';
import { env } from './env.js';

const globalState = globalThis;

if (!globalState.__mongooseCache) {
  globalState.__mongooseCache = { conn: null, promise: null };
}

const cache = globalState.__mongooseCache;

/** Connects to the registry database (`Organization` catalog). Tenant app data uses separate DBs via `useDb`. */
export async function connectDb() {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    mongoose.set('strictQuery', true);
    cache.promise = mongoose.connect(env.MONGODB_URI).then((m) => m.connection);
  }

  cache.conn = await cache.promise;
  return cache.conn;
}

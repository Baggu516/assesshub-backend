import mongoose from 'mongoose';
import { env } from './env.js';

/** Connects to the registry database (`Organization` catalog). Tenant app data uses separate DBs via `useDb`. */
export async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI);
  return mongoose.connection;
}

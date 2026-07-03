import dotenv from 'dotenv';

dotenv.config();

const required = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

export function loadEnv() {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(`Warning: missing env: ${missing.join(', ')}`);
  }
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '4000', 10),
  /** Registry DB (organizations catalog). Tenant data lives in separate DBs per subdomain. */
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/task-saas-registry',
  /** Database name suffix: `${prefix}${subdomain}` on the same MongoDB cluster as the registry. */
  TENANT_DB_PREFIX: process.env.TENANT_DB_PREFIX || 'tm_tenant_',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-min-32-characters-long',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-min-32-characters-long',
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  BASE_DOMAIN: process.env.BASE_DOMAIN || 'taskmanagement.com',
  /** When set, plain localhost/127.0.0.1 requests without Host subdomain use this org slug (dev convenience). */
  DEFAULT_TENANT_SUBDOMAIN: process.env.DEFAULT_TENANT_SUBDOMAIN || '',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '200', 10),
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  MAIL_FROM: process.env.MAIL_FROM || 'noreply@taskmanagement.com',
  /** Legacy/script auth: send header `X-Platform-Key`. Optional if email/password login is configured. */
  PLATFORM_ADMIN_API_KEY: process.env.PLATFORM_ADMIN_API_KEY || '',
  /** Super-admin email for `/api/platform/login`. */
  PLATFORM_ADMIN_EMAIL: process.env.PLATFORM_ADMIN_EMAIL || '',
  /** Plain password (dev only). Prefer `PLATFORM_ADMIN_PASSWORD_HASH` in production. */
  PLATFORM_ADMIN_PASSWORD: process.env.PLATFORM_ADMIN_PASSWORD || '',
  /** bcrypt hash of platform admin password (recommended for production). */
  PLATFORM_ADMIN_PASSWORD_HASH: process.env.PLATFORM_ADMIN_PASSWORD_HASH || '',
  /** Signs platform session JWT (use a long random value in production). */
  PLATFORM_ADMIN_JWT_SECRET:
    process.env.PLATFORM_ADMIN_JWT_SECRET || 'dev-platform-admin-jwt-secret-min-32-characters-long',
  PLATFORM_ADMIN_TOKEN_EXPIRES_IN: process.env.PLATFORM_ADMIN_TOKEN_EXPIRES_IN || '8h',
  /** Google AI Studio / Gemini (server only). */
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  /** Groq OpenAI-compatible API (server only). */
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  GEMINI_CHAT_MODEL: process.env.GEMINI_CHAT_MODEL || 'gemini-2.0-flash',
  GROQ_CHAT_MODEL: process.env.GROQ_CHAT_MODEL || 'llama-3.1-8b-instant',
  /** Optional extra lines appended to dashboard AI “Intentions” (plain text, keep short). */
  AI_CHAT_INTENTIONS_EXTRA: (process.env.AI_CHAT_INTENTIONS_EXTRA || '').trim().slice(0, 2000),
  /** Optional extra lines appended to dashboard AI “Constraints” (plain text, keep short). */
  AI_CHAT_CONSTRAINTS_EXTRA: (process.env.AI_CHAT_CONSTRAINTS_EXTRA || '').trim().slice(0, 2000),
  /** Max upload size for knowledge-base files (bytes). */
  KB_MAX_UPLOAD_BYTES: parseInt(process.env.KB_MAX_UPLOAD_BYTES || String(12 * 1024 * 1024), 10),
};

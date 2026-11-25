import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase().trim();

// Load environment configuration in cascading priority order:
// 1. .env.<NODE_ENV>.local (highest priority, untracked local overrides)
// 2. .env.<NODE_ENV>       (e.g., .env.development, .env.production, .env.testing)
// 3. .env.local            (shared untracked local overrides)
// 4. .env                  (base defaults and shared fallback settings)
const candidates = [
  path.join(rootDir, `.env.${nodeEnv}.local`),
  path.join(rootDir, `.env.${nodeEnv}`),
  path.join(rootDir, '.env.local'),
  path.join(rootDir, '.env'),
];

for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
  }
}

export const currentEnv = nodeEnv;
export const isProduction = nodeEnv === 'production' || nodeEnv === 'prod';
export const isDevelopment = nodeEnv === 'development' || nodeEnv === 'dev';
export const isTesting = nodeEnv === 'test' || nodeEnv === 'testing';

export default process.env;

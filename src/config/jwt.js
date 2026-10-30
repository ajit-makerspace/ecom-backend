import dotenv from 'dotenv';
dotenv.config();

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET environment variable must be defined in production.');
}

export const JWT_SECRET = process.env.JWT_SECRET || 'makerspace_prod_secure_jwt_secret_key_2026_98a7bc';
export const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m';
export const REFRESH_TOKEN_EXPIRY_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS || '30', 10);
export default JWT_SECRET;

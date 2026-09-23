import dotenv from 'dotenv';
dotenv.config();

export const JWT_SECRET = process.env.JWT_SECRET || 'makerspace_super_secure_jwt_secret_key_2026';
export default JWT_SECRET;

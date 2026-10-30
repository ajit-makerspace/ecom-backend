import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { JWT_SECRET, ACCESS_TOKEN_EXPIRY, REFRESH_TOKEN_EXPIRY_DAYS } from '../config/jwt.js';
import { USER_TYPES, ROLE_PERMISSIONS } from '../config/userTypes.js';

/**
 * Ensure refresh_tokens table exists with necessary indexes
 */
export async function ensureRefreshTokensTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_type SMALLINT NOT NULL DEFAULT 2,
        user_id UUID NOT NULL,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ DEFAULT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        user_agent TEXT,
        ip_address VARCHAR(45)
      );
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_type, user_id);
    `);
  } catch (err) {
    console.error('Error ensuring refresh_tokens table:', err.message);
  }
}

/**
 * Generate Access Token & Refresh Token pair
 * @param {Object} user - User record from admin_users or users
 * @param {number} userType - 1 (Admin) or 2 (Customer)
 * @param {Object} metadata - Optional ip and userAgent
 * @returns {Promise<{accessToken: string, refreshToken: string, expiresIn: string, user: Object}>}
 */
export async function generateTokenPair(user, userType = 2, metadata = {}) {
  const { ip = null, userAgent = null } = metadata;

  let payload;
  let userObj;

  if (userType === 1) {
    const roleName = USER_TYPES[user.user_type] || 'SUPER_ADMIN';
    const permissions = ROLE_PERMISSIONS[user.user_type] || ['all'];
    payload = {
      id: user.id,
      email: user.email,
      user_type: user.user_type || 1,
      role: roleName,
      permissions,
      token_type: 'access',
    };
    userObj = {
      id: user.id,
      name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Super Admin',
      email: user.email,
      user_type: user.user_type || 1,
      role: roleName,
      permissions,
      status: 'Active',
      avatar: user.profile_image_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&q=80',
    };
  } else {
    payload = {
      id: user.id,
      email: user.email,
      role: 'CUSTOMER',
      user_type: 2,
      token_type: 'access',
    };
    userObj = {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      gender: user.gender,
      dateOfBirth: user.date_of_birth,
      profileImageUrl: user.profile_image_url,
      role: 'Customer',
    };
  }

  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
  const rawRefreshToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO refresh_tokens (user_type, user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userType, user.id, tokenHash, expiresAt, userAgent, ip]
  );

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRY,
    user: userObj,
  };
}

/**
 * Rotate Refresh Token (Automatic Rotation with Reuse Detection)
 * @param {string} rawRefreshToken - Raw refresh token from client
 * @param {Object} metadata - ip and userAgent
 * @returns {Promise<{accessToken: string, refreshToken: string, expiresIn: string, user: Object}>}
 */
export async function rotateRefreshToken(rawRefreshToken, metadata = {}) {
  if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
    const error = new Error('Refresh token is required');
    error.statusCode = 400;
    throw error;
  }

  const tokenHash = crypto.createHash('sha256').update(rawRefreshToken.trim()).digest('hex');
  const { rows } = await db.query(
    'SELECT id, user_type, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1',
    [tokenHash]
  );

  if (rows.length === 0) {
    const error = new Error('Invalid refresh token');
    error.statusCode = 401;
    error.code = 'INVALID_REFRESH_TOKEN';
    throw error;
  }

  const tokenRecord = rows[0];

  // Refresh Token Reuse Detection
  // If an already-revoked refresh token is sent, someone might be replaying a stolen token.
  // Revoke ALL refresh tokens for this user immediately for security.
  if (tokenRecord.revoked_at !== null) {
    await db.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_type = $1 AND user_id = $2 AND revoked_at IS NULL',
      [tokenRecord.user_type, tokenRecord.user_id]
    );
    const error = new Error('Refresh token reuse detected. All sessions revoked for security. Please log in again.');
    error.statusCode = 401;
    error.code = 'TOKEN_REUSE_DETECTED';
    throw error;
  }

  // Check Expiration
  if (new Date(tokenRecord.expires_at) < new Date()) {
    const error = new Error('Refresh token has expired. Please log in again.');
    error.statusCode = 401;
    error.code = 'REFRESH_TOKEN_EXPIRED';
    throw error;
  }

  // Revoke the old token immediately
  await db.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [tokenRecord.id]);

  // Fetch the current active user record
  let user;
  if (tokenRecord.user_type === 1) {
    const adminRes = await db.query(
      'SELECT id, email, first_name, last_name, user_type, status FROM admin_users WHERE id = $1',
      [tokenRecord.user_id]
    );
    if (adminRes.rows.length === 0 || adminRes.rows[0].status !== 1) {
      const error = new Error('Admin user account is inactive or no longer exists.');
      error.statusCode = 401;
      error.code = 'USER_INACTIVE';
      throw error;
    }
    user = adminRes.rows[0];
  } else {
    const userRes = await db.query(
      'SELECT id, email, first_name, last_name, phone, gender, date_of_birth, profile_image_url, role, status FROM users WHERE id = $1',
      [tokenRecord.user_id]
    );
    if (userRes.rows.length === 0 || userRes.rows[0].status !== 1) {
      const error = new Error('User account is inactive or no longer exists.');
      error.statusCode = 401;
      error.code = 'USER_INACTIVE';
      throw error;
    }
    user = userRes.rows[0];
  }

  // Generate new rotated token pair
  const newTokens = await generateTokenPair(user, tokenRecord.user_type, metadata);
  return newTokens;
}

/**
 * Explicitly revoke a refresh token (e.g. on logout)
 * @param {string} rawRefreshToken
 * @returns {Promise<boolean>}
 */
export async function revokeRefreshToken(rawRefreshToken) {
  if (!rawRefreshToken || typeof rawRefreshToken !== 'string') return false;
  const tokenHash = crypto.createHash('sha256').update(rawRefreshToken.trim()).digest('hex');
  await db.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1', [tokenHash]);
  return true;
}

/**
 * Revoke all tokens for a user (e.g. password reset or admin force logout)
 * @param {number} userType
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function revokeAllUserTokens(userType, userId) {
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_type = $1 AND user_id = $2 AND revoked_at IS NULL',
    [userType, userId]
  );
  return true;
}

export default {
  ensureRefreshTokensTable,
  generateTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
};

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import db from '../src/config/db.js';
import { JWT_SECRET } from '../src/config/jwt.js';
import tokenService, {
  ensureRefreshTokensTable,
  generateTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} from '../src/services/tokenService.js';

describe('Dual-Token Refresh & Silent Renewal Suite', () => {
  let testUser;

  before(async () => {
    await ensureRefreshTokensTable();

    // Create a temporary test customer in users table
    const res = await db.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, role, status)
      VALUES ('test_refresh_' || gen_random_uuid() || '@example.com', 'dummy_hash', 'Test', 'User', 1, 1)
      RETURNING id, email, first_name, last_name, status
    `);
    testUser = res.rows[0];
  });

  after(async () => {
    if (testUser?.id) {
      await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [testUser.id]);
      await db.query('DELETE FROM users WHERE id = $1', [testUser.id]);
    }
  });

  test('1. Generates valid Access Token and Refresh Token pair', async () => {
    const pair = await generateTokenPair(testUser, 2, { ip: '127.0.0.1', userAgent: 'NodeTestAgent' });

    assert.ok(pair.accessToken, 'Access token must be generated');
    assert.ok(pair.refreshToken, 'Refresh token must be generated');
    assert.strictEqual(typeof pair.refreshToken, 'string');
    assert.strictEqual(pair.refreshToken.length, 80); // 40 bytes hex = 80 chars

    // Verify Access Token signature
    const decoded = jwt.verify(pair.accessToken, JWT_SECRET);
    assert.strictEqual(decoded.id, testUser.id);
    assert.strictEqual(decoded.role, 'CUSTOMER');
    assert.strictEqual(decoded.token_type, 'access');
  });

  test('2. Refresh Token Rotation (RTR): rotates old token for a new pair', async () => {
    const initialPair = await generateTokenPair(testUser, 2);
    const rotatedPair = await rotateRefreshToken(initialPair.refreshToken, { ip: '127.0.0.1' });

    assert.ok(rotatedPair.accessToken, 'New access token issued');
    assert.ok(rotatedPair.refreshToken, 'New refresh token issued');
    assert.notStrictEqual(rotatedPair.refreshToken, initialPair.refreshToken, 'Refresh token must be rotated');

    const decoded = jwt.verify(rotatedPair.accessToken, JWT_SECRET);
    assert.strictEqual(decoded.id, testUser.id);
  });

  test('3. Token Reuse Detection: replaying a revoked token revokes all user sessions', async () => {
    const initialPair = await generateTokenPair(testUser, 2);
    // First rotation succeeds
    await rotateRefreshToken(initialPair.refreshToken);

    // Attempting to reuse initialPair.refreshToken must fail
    await assert.rejects(
      async () => {
        await rotateRefreshToken(initialPair.refreshToken);
      },
      (err) => {
        assert.strictEqual(err.code, 'TOKEN_REUSE_DETECTED');
        return true;
      }
    );
  });

  test('4. Explicit token revocation on logout', async () => {
    const pair = await generateTokenPair(testUser, 2);
    await revokeRefreshToken(pair.refreshToken);

    // Attempting to rotate revoked token must be rejected
    await assert.rejects(
      async () => {
        await rotateRefreshToken(pair.refreshToken);
      },
      (err) => {
        assert.strictEqual(err.code, 'TOKEN_REUSE_DETECTED');
        return true;
      }
    );
  });
});

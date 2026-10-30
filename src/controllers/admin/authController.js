import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../../config/db.js';
import { USER_TYPES, ROLE_PERMISSIONS } from '../../config/userTypes.js';
import { JWT_SECRET } from '../../config/jwt.js';
import { sendAdminCredentialsEmail } from '../../services/emailService.js';
import tokenService from '../../services/tokenService.js';

// Raw SQL RBAC Login Controller
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanPassword = String(password).trim();

    // Raw SQL Query to fetch user
    const { rows } = await db.query(
      'SELECT id, email, password_hash, first_name, last_name, user_type, status FROM admin_users WHERE LOWER(email) = $1',
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const user = rows[0];

    // Check status
    if (user.status !== 1) {
      return res.status(403).json({ success: false, message: 'Account is deactivated.' });
    }

    // Verify bcrypt password
    const isPasswordValid = await bcrypt.compare(cleanPassword, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    // Update last_login_at via raw SQL
    await db.query('UPDATE admin_users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const tokenPair = await tokenService.generateTokenPair(user, 1, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      success: true,
      message: 'Login successful.',
      token: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      user: tokenPair.user,
    });
  } catch (err) {
    console.error('Auth RBAC Login Controller Error:', err);
    return res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

/**
 * POST /api/admin/auth/refresh
 * Silent renewal for Admin Access Token via Refresh Token
 */
export const refreshSession = async (req, res) => {
  try {
    const rawRefreshToken = req.body?.refreshToken || req.headers['x-refresh-token'];
    if (!rawRefreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token is required.' });
    }

    const newTokens = await tokenService.rotateRefreshToken(rawRefreshToken, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      success: true,
      message: 'Token refreshed successfully.',
      token: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
      expiresIn: newTokens.expiresIn,
      user: newTokens.user,
    });
  } catch (err) {
    const status = err.statusCode || 401;
    return res.status(status).json({
      success: false,
      code: err.code || 'REFRESH_FAILED',
      message: err.message || 'Failed to refresh token.',
    });
  }
};

/**
 * POST /api/admin/auth/logout
 * Revoke Admin Refresh Token
 */
export const logout = async (req, res) => {
  try {
    const rawRefreshToken = req.body?.refreshToken || req.headers['x-refresh-token'];
    if (rawRefreshToken) {
      await tokenService.revokeRefreshToken(rawRefreshToken);
    }
    return res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error during logout.' });
  }
};

// Raw SQL Get Me Controller
export const getMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await db.query(
      'SELECT id, email, plain_password, first_name, last_name, phone, user_type, status FROM admin_users WHERE id = $1',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const u = rows[0];
    const roleName = USER_TYPES[u.user_type] || 'USER';
    const permissions = ROLE_PERMISSIONS[u.user_type] || [];

    return res.json({
      success: true,
      user: {
        id: u.id,
        name: `${u.firstName || u.first_name || ''} ${u.lastName || u.last_name || ''}`.trim() || 'Super Admin',
        firstName: u.first_name || '',
        lastName: u.last_name || '',
        phone: u.phone || '',
        email: u.email,
        password: u.plain_password || '',
        user_type: u.user_type,
        role: roleName,
        permissions,
        status: u.status === 1 ? 'Active' : 'Inactive',
      },
    });
  } catch (err) {
    console.error('Auth Me Controller Error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching user.' });
  }
};

// Get All Admin Users
export const getAdminUsers = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        id,
        email,
        plain_password AS "password",
        first_name AS "firstName",
        last_name AS "lastName",
        phone,
        user_type AS "userType",
        status,
        last_login_at AS "lastLoginAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM admin_users
      ORDER BY created_at ASC
    `);

    const users = rows.map((u) => {
      const roleName = USER_TYPES[u.userType] || 'ADMIN';
      const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email.split('@')[0];
      return {
        id: u.id,
        name: fullName,
        firstName: u.firstName || '',
        lastName: u.lastName || '',
        email: u.email,
        password: u.password || '',
        phone: u.phone || '',
        userType: u.userType,
        role: roleName,
        status: u.status === 1 ? 'Active' : 'Inactive',
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      };
    });

    return res.json({
      success: true,
      count: users.length,
      users,
    });
  } catch (err) {
    console.error('Get Admin Users Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch admin users roster.' });
  }
};

// Helper to generate a secure random password for administrators
function generateRandomAdminPassword(length = 10) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%*';

  // Ensure at least one character from each character set
  const pwd = [
    upper[crypto.randomInt(0, upper.length)],
    lower[crypto.randomInt(0, lower.length)],
    digits[crypto.randomInt(0, digits.length)],
    symbols[crypto.randomInt(0, symbols.length)],
  ];

  const allChars = upper + lower + digits + symbols;
  for (let i = pwd.length; i < length; i++) {
    pwd.push(allChars[crypto.randomInt(0, allChars.length)]);
  }

  // Fisher-Yates shuffle
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }

  return pwd.join('');
}

// Create a New Admin User & Email Credentials
export const createAdminUser = async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone, userType } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }

    if (!password || String(password).trim().length < 6) {
      return res.status(400).json({ success: false, message: 'Password is required and must be at least 6 characters.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const plainPassword = String(password).trim();

    // Check if email already exists
    const { rows: existing } = await db.query(
      'SELECT id FROM admin_users WHERE LOWER(email) = $1',
      [cleanEmail]
    );

    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'An admin with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(plainPassword, salt);
    const typeInt = parseInt(userType || 1, 10);

    const { rows } = await db.query(
      `INSERT INTO admin_users (email, password_hash, plain_password, first_name, last_name, phone, user_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
       RETURNING id, email, plain_password AS "password", first_name AS "firstName", last_name AS "lastName", phone, user_type AS "userType", status, created_at AS "createdAt"`,
      [
        cleanEmail,
        passwordHash,
        plainPassword,
        firstName ? String(firstName).trim() : null,
        lastName ? String(lastName).trim() : null,
        phone ? String(phone).trim() : null,
        typeInt,
      ]
    );

    const u = rows[0];
    const roleName = USER_TYPES[u.userType] || 'ADMIN';
    const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/makerspace/admin`;

    // Dispatch automated credentials email
    try {
      await sendAdminCredentialsEmail({
        email: cleanEmail,
        firstName: u.firstName || 'Administrator',
        password: plainPassword,
        roleName,
        loginUrl,
      });
      console.log(`[AdminAuth] Credentials email dispatched to ${cleanEmail}`);
    } catch (emailErr) {
      console.error(`[AdminAuth] Failed to dispatch credentials email to ${cleanEmail}:`, emailErr.message);
    }

    return res.status(201).json({
      success: true,
      message: `Admin user created successfully. Login credentials emailed to ${cleanEmail}.`,
      user: {
        id: u.id,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email.split('@')[0],
        firstName: u.firstName || '',
        lastName: u.lastName || '',
        email: u.email,
        password: u.password || plainPassword,
        phone: u.phone || '',
        userType: u.userType,
        role: roleName,
        status: 'Active',
        createdAt: u.createdAt,
      },
      generatedPassword: plainPassword,
    });
  } catch (err) {
    console.error('Create Admin User Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create admin user.' });
  }
};

// Update Admin User Status (Active / Inactive)
export const updateAdminUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Prevent admin from deactivating their own account
    if (req.user && String(req.user.id) === String(id)) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own administrative account.' });
    }

    const statusInt = String(status).toLowerCase() === 'active' || status === 1 ? 1 : 0;

    const { rows } = await db.query(
      `UPDATE admin_users
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, first_name AS "firstName", last_name AS "lastName", status`,
      [statusInt, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin user not found.' });
    }

    const u = rows[0];
    return res.json({
      success: true,
      message: `Admin status updated to ${statusInt === 1 ? 'Active' : 'Inactive'}.`,
      user: {
        id: u.id,
        status: u.status === 1 ? 'Active' : 'Inactive',
      },
    });
  } catch (err) {
    console.error('Update Admin Status Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update admin user status.' });
  }
};

// Update Admin User (by admin)
export const updateAdminUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, phone, email, password, userType, status } = req.body;

    const { rows: existingRows } = await db.query(
      'SELECT id, email, first_name AS "firstName", user_type AS "userType" FROM admin_users WHERE id = $1',
      [id]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin user not found.' });
    }

    const existingUser = existingRows[0];

    // If changing email, check for duplicate
    if (email && email.toLowerCase().trim() !== existingUser.email.toLowerCase().trim()) {
      const cleanEmail = String(email).toLowerCase().trim();
      const { rows: duplicate } = await db.query(
        'SELECT id FROM admin_users WHERE LOWER(email) = $1 AND id != $2',
        [cleanEmail, id]
      );
      if (duplicate.length > 0) {
        return res.status(409).json({ success: false, message: 'Email address is already in use by another administrator.' });
      }
    }

    // Prevent deactivating own account
    if (req.user && String(req.user.id) === String(id) && (status === 0 || status === 'Inactive')) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own administrative account.' });
    }

    let updateFields = [];
    let values = [];
    let idx = 1;

    if (firstName !== undefined) {
      updateFields.push(`first_name = $${idx++}`);
      values.push(String(firstName).trim());
    }
    if (lastName !== undefined) {
      updateFields.push(`last_name = $${idx++}`);
      values.push(String(lastName).trim());
    }
    if (phone !== undefined) {
      updateFields.push(`phone = $${idx++}`);
      values.push(String(phone).trim());
    }
    if (email !== undefined) {
      updateFields.push(`email = $${idx++}`);
      values.push(String(email).toLowerCase().trim());
    }
    if (userType !== undefined) {
      updateFields.push(`user_type = $${idx++}`);
      values.push(parseInt(userType, 10));
    }
    if (status !== undefined) {
      const statusInt = String(status).toLowerCase() === 'active' || status === 1 ? 1 : 0;
      updateFields.push(`status = $${idx++}`);
      values.push(statusInt);
    }
    if (password !== undefined && password !== null && String(password).trim().length > 0) {
      if (String(password).trim().length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
      }
      const cleanPwd = String(password).trim();
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(cleanPwd, salt);
      updateFields.push(`password_hash = $${idx++}`);
      values.push(hash);
      updateFields.push(`plain_password = $${idx++}`);
      values.push(cleanPwd);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields provided to update.' });
    }

    updateFields.push('updated_at = NOW()');
    values.push(id);

    const query = `
      UPDATE admin_users
      SET ${updateFields.join(', ')}
      WHERE id = $${idx}
      RETURNING id, email, plain_password AS "password", first_name AS "firstName", last_name AS "lastName", phone, user_type AS "userType", status, updated_at AS "updatedAt"
    `;

    const { rows } = await db.query(query, values);
    const u = rows[0];
    const roleName = USER_TYPES[u.userType] || 'ADMIN';

    return res.json({
      success: true,
      message: 'Admin user updated successfully.',
      user: {
        id: u.id,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email.split('@')[0],
        firstName: u.firstName || '',
        lastName: u.lastName || '',
        email: u.email,
        password: u.password || '',
        phone: u.phone || '',
        userType: u.userType,
        role: roleName,
        status: u.status === 1 ? 'Active' : 'Inactive',
        updatedAt: u.updatedAt,
      },
    });
  } catch (err) {
    console.error('Update Admin User Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update admin user.' });
  }
};

// Delete Admin User
export const deleteAdminUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting own account
    if (req.user && String(req.user.id) === String(id)) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own administrative account.' });
    }

    // Check how many super admins remain
    const { rows: superAdminCount } = await db.query(
      'SELECT COUNT(*)::int AS count FROM admin_users WHERE user_type = 1'
    );
    const { rows: targetUser } = await db.query(
      'SELECT id, user_type FROM admin_users WHERE id = $1',
      [id]
    );

    if (targetUser.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin user not found.' });
    }

    if (targetUser[0].user_type === 1 && (superAdminCount[0]?.count || 0) <= 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete the only remaining Super Administrator account in the system.',
      });
    }

    await db.query('DELETE FROM admin_users WHERE id = $1', [id]);

    return res.json({
      success: true,
      message: 'Admin user deleted successfully.',
    });
  } catch (err) {
    console.error('Delete Admin User Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete admin user.' });
  }
};

// Update Admin Profile (self)
export const updateAdminProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { firstName, lastName, phone, email, password } = req.body;

    let updateFields = [];
    let values = [];
    let idx = 1;

    if (firstName !== undefined) {
      updateFields.push(`first_name = $${idx++}`);
      values.push(String(firstName).trim());
    }
    if (lastName !== undefined) {
      updateFields.push(`last_name = $${idx++}`);
      values.push(String(lastName).trim());
    }
    if (phone !== undefined) {
      updateFields.push(`phone = $${idx++}`);
      values.push(String(phone).trim());
    }
    if (email) {
      const cleanEmail = String(email).toLowerCase().trim();
      // Check if another admin already uses this email
      const { rows: duplicate } = await db.query(
        'SELECT id FROM admin_users WHERE LOWER(email) = $1 AND id != $2',
        [cleanEmail, userId]
      );
      if (duplicate.length > 0) {
        return res.status(409).json({ success: false, message: 'Email is already in use by another administrator.' });
      }
      updateFields.push(`email = $${idx++}`);
      values.push(cleanEmail);
    }
    if (password !== undefined && password !== null && String(password).trim().length > 0) {
      if (String(password).trim().length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
      }
      const cleanPwd = String(password).trim();
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(cleanPwd, salt);
      updateFields.push(`password_hash = $${idx++}`);
      values.push(hash);
      updateFields.push(`plain_password = $${idx++}`);
      values.push(cleanPwd);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields provided to update.' });
    }

    updateFields.push('updated_at = NOW()');
    values.push(userId);

    const query = `
      UPDATE admin_users
      SET ${updateFields.join(', ')}
      WHERE id = $${idx}
      RETURNING id, email, plain_password AS "password", first_name AS "firstName", last_name AS "lastName", phone, user_type AS "userType", status
    `;

    const { rows } = await db.query(query, values);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin not found.' });
    }

    const u = rows[0];
    const roleName = USER_TYPES[u.userType] || 'ADMIN';

    return res.json({
      success: true,
      message: 'Admin profile updated successfully.',
      user: {
        id: u.id,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email.split('@')[0],
        firstName: u.firstName || '',
        lastName: u.lastName || '',
        email: u.email,
        password: u.password || '',
        phone: u.phone || '',
        user_type: u.userType,
        role: roleName,
        status: u.status === 1 ? 'Active' : 'Inactive',
      },
    });
  } catch (err) {
    console.error('Update Admin Profile Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
};

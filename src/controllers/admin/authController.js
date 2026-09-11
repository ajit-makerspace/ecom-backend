import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../../config/db.js';
import { USER_TYPES, ROLE_PERMISSIONS } from '../../config/userTypes.js';

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

    const roleName = USER_TYPES[user.user_type] || 'USER';
    const permissions = ROLE_PERMISSIONS[user.user_type] || [];

    // Issue JWT Token with RBAC claims
    const payload = {
      id: user.id,
      email: user.email,
      user_type: user.user_type,
      role: roleName,
      permissions,
    };

    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET || 'supersecretkey123_aura_admin',
      { expiresIn: '7d' }
    );

    const userObj = {
      id: user.id,
      name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Super Admin',
      email: user.email,
      user_type: user.user_type,
      role: roleName,
      permissions,
      status: 'Active',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&q=80',
    };

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: userObj,
    });
  } catch (err) {
    console.error('Auth RBAC Login Controller Error:', err);
    return res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

// Raw SQL Get Me Controller
export const getMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await db.query(
      'SELECT id, email, first_name, last_name, user_type, status FROM admin_users WHERE id = $1',
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
        name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Super Admin',
        email: u.email,
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

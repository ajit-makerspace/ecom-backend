import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { USER_TYPES, ROLE_PERMISSIONS } from '../config/userTypes.js';

// Authentication JWT Token Verification
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token required.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretkey123_aura_admin');
    
    // Fetch user from DB using raw SQL query with destructured { rows }
    const { rows } = await db.query(
      'SELECT id, email, first_name, last_name, user_type, status FROM admin_users WHERE id = $1',
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid user session.' });
    }

    const user = rows[0];
    req.user = {
      ...user,
      roleName: USER_TYPES[user.user_type] || 'UNKNOWN',
      permissions: ROLE_PERMISSIONS[user.user_type] || [],
    };
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
  }
}

// RBAC Middleware: Require specific user_type role(s)
export function requireRole(allowedRoles = []) {
  const rolesArray = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthenticated.' });
    }

    if (rolesArray.includes(req.user.user_type)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Access denied. Requires one of roles: ${rolesArray.map((r) => USER_TYPES[r] || r).join(', ')}. Your role is ${req.user.roleName}.`,
    });
  };
}

// RBAC Middleware: Require specific permission name
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthenticated.' });
    }

    // Super Admin (user_type = 1) has all permissions
    if (req.user.user_type === 1 || req.user.permissions.includes(permission)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Access denied. Required permission "${permission}" is missing for role ${req.user.roleName}.`,
    });
  };
}

export function requireAdmin(req, res, next) {
  return requireRole([1])(req, res, next);
}

export default {
  authenticateToken,
  requireRole,
  requirePermission,
  requireAdmin,
};

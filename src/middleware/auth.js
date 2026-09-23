import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { USER_TYPES, ROLE_PERMISSIONS } from '../config/userTypes.js';
import { JWT_SECRET } from '../config/jwt.js';

// Universal Authentication JWT Token Verification
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Case A: Admin User
    if (decoded.role === 'SUPER_ADMIN' || decoded.user_type === 1) {
      const { rows } = await db.query(
        'SELECT id, email, first_name, last_name, user_type, status FROM admin_users WHERE id = $1',
        [decoded.id]
      );

      if (rows.length === 0 || rows[0].status !== 1) {
        return res.status(401).json({ success: false, message: 'Invalid or inactive admin session.' });
      }

      const user = rows[0];
      req.user = {
        ...user,
        roleName: USER_TYPES[user.user_type] || 'SUPER_ADMIN',
        permissions: ROLE_PERMISSIONS[user.user_type] || ['all'],
      };
      return next();
    }

    // Case B: Customer User
    const { rows } = await db.query(
      'SELECT id, email, first_name, last_name, phone, role, status FROM users WHERE id = $1',
      [decoded.id]
    );

    if (rows.length === 0 || rows[0].status !== 1) {
      return res.status(401).json({ success: false, message: 'Invalid or deactivated customer session.' });
    }

    const customer = rows[0];
    req.user = {
      ...customer,
      user_type: 2,
      roleName: 'CUSTOMER',
      permissions: ['view_products', 'create_order', 'view_own_orders'],
    };
    return next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid or expired session token.' });
  }
}

// Optional Auth (e.g. for Storefront Checkout: logs order against user if token valid, else guest)
export async function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { rows } = await db.query(
      'SELECT id, email, first_name, last_name, phone, role, status FROM users WHERE id = $1',
      [decoded.id]
    );
    if (rows.length > 0 && rows[0].status === 1) {
      req.user = {
        ...rows[0],
        user_type: 2,
        roleName: 'CUSTOMER',
      };
    } else {
      req.user = null;
    }
  } catch (e) {
    req.user = null;
  }
  next();
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
      message: `Access denied. Requires one of roles: ${rolesArray.map((r) => USER_TYPES[r] || r).join(', ')}.`,
    });
  };
}

export function requireAdmin(req, res, next) {
  return requireRole([1])(req, res, next);
}

export function requireCustomer(req, res, next) {
  return requireRole([2])(req, res, next);
}

export default {
  authenticateToken,
  optionalAuth,
  requireRole,
  requireAdmin,
  requireCustomer,
};

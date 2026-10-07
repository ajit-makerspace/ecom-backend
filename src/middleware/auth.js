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

      const adminUser = rows[0];

      // Ensure a matching customer record in `users` exists for cart/wishlist/orders foreign key compatibility
      let customerId = adminUser.id;
      let { rows: userRows } = await db.query(
        'SELECT id, email, first_name, last_name, phone, role, status FROM users WHERE LOWER(email) = LOWER($1)',
        [adminUser.email]
      );
      if (userRows.length === 0) {
        const insertUser = await db.query(
          `INSERT INTO users (email, password_hash, first_name, last_name, phone, status, role, created_at, updated_at)
           VALUES ($1, 'LINKED_ADMIN', $2, $3, $4, 1, 'Customer', NOW(), NOW())
           RETURNING id, email, first_name, last_name, phone, role, status`,
          [adminUser.email, adminUser.first_name || 'Admin', adminUser.last_name || 'User', '']
        );
        userRows = insertUser.rows;
      }
      if (userRows.length > 0) {
        customerId = userRows[0].id;
      }

      req.user = {
        ...adminUser,
        id: customerId, // valid users.id for user tables (carts, wishlists, orders)
        adminId: adminUser.id,
        roleName: USER_TYPES[adminUser.user_type] || 'SUPER_ADMIN',
        permissions: ROLE_PERMISSIONS[adminUser.user_type] || ['all'],
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

// Optional Auth (e.g. for Storefront Checkout, Cart & Wishlist: logs order against user if token valid, else guest)
export async function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Case A: Admin User visiting storefront endpoints
    if (decoded.role === 'SUPER_ADMIN' || decoded.user_type === 1) {
      const { rows: adminRows } = await db.query(
        'SELECT id, email, first_name, last_name, phone, user_type, status FROM admin_users WHERE id = $1',
        [decoded.id]
      );
      if (adminRows.length > 0 && adminRows[0].status === 1) {
        const adminUser = adminRows[0];
        let { rows: userRows } = await db.query(
          'SELECT id, email, first_name, last_name, phone, role, status FROM users WHERE LOWER(email) = LOWER($1)',
          [adminUser.email]
        );
        if (userRows.length === 0) {
          const insertUser = await db.query(
            `INSERT INTO users (email, password_hash, first_name, last_name, phone, status, role, created_at, updated_at)
             VALUES ($1, 'LINKED_ADMIN', $2, $3, $4, 1, 'Customer', NOW(), NOW())
             RETURNING id, email, first_name, last_name, phone, role, status`,
            [adminUser.email, adminUser.first_name || 'Admin', adminUser.last_name || 'User', adminUser.phone || '']
          );
          userRows = insertUser.rows;
        }
        if (userRows.length > 0) {
          req.user = {
            ...userRows[0],
            adminId: adminUser.id,
            user_type: 2,
            roleName: 'CUSTOMER',
            isAdmin: true,
          };
          return next();
        }
      }
    }

    // Case B: Standard Customer lookup
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
  const rolesArray = (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]).map((r) => String(r));

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthenticated.' });
    }

    const userTypeStr = String(req.user.user_type || req.user.role || '');

    if (userTypeStr === '1' || req.user.roleName === 'SUPER_ADMIN' || rolesArray.includes(userTypeStr) || rolesArray.length === 0) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Access denied. Requires one of roles: ${rolesArray.map((r) => USER_TYPES[r] || r).join(', ')}.`,
    });
  };
}

export function requireAdmin(req, res, next) {
  return requireRole([1, '1'])(req, res, next);
}

export function requireCustomer(req, res, next) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthenticated.' });
    }
    return next();
  };
}

export default {
  authenticateToken,
  optionalAuth,
  requireRole,
  requireAdmin,
  requireCustomer,
};

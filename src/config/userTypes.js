// Role & User Type Definitions for Role-Based Access Control (RBAC)
export const USER_TYPES = {
  1: 'SUPER_ADMIN',
  2: 'CUSTOMER',
  3: 'VENDOR',
  4: 'STAFF',
};

export const USER_TYPE_CODES = {
  SUPER_ADMIN: 1,
  CUSTOMER: 2,
  VENDOR: 3,
  STAFF: 4,
};

export const ROLE_PERMISSIONS = {
  1: [
    'manage_users',
    'manage_categories',
    'manage_subcategories',
    'manage_products',
    'manage_orders',
    'view_analytics',
    'manage_settings',
  ],
  2: ['view_products', 'create_order', 'view_own_orders'],
  3: ['manage_products', 'view_orders', 'view_analytics'],
  4: ['view_categories', 'manage_products', 'manage_orders', 'view_customers'],
};

export default {
  USER_TYPES,
  USER_TYPE_CODES,
  ROLE_PERMISSIONS,
};

// Role & User Type Definitions for Role-Based Access Control (RBAC)
export const USER_TYPES = {
  1: 'SUPER_ADMIN',
  4: '3D',
  5: 'STAFF',
};

export const USER_TYPE_CODES = {
  SUPER_ADMIN: 1,
  '3D': 4,
  STAFF: 5,
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
    'manage_prototype_services',
  ],
  4: ['view_prototype_services', 'manage_prototype_services'],
  5: [
    'view_categories',
    'manage_categories',
    'manage_subcategories',
    'view_products',
    'manage_products',
    'view_marketing',
    'manage_marketing',
    'manage_banners',
    'manage_competitions',
    'manage_showcases',
  ],
};

export default {
  USER_TYPES,
  USER_TYPE_CODES,
  ROLE_PERMISSIONS,
};

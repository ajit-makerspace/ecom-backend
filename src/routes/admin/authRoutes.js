import express from 'express';
import {
  login,
  refreshSession,
  logout,
  getMe,
  getAdminUsers,
  createAdminUser,
  updateAdminUser,
  updateAdminUserStatus,
  deleteAdminUser,
  updateAdminProfile,
} from '../../controllers/admin/authController.js';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';

const router = express.Router();

router.post('/login', login);
router.post('/refresh', refreshSession);
router.post('/logout', logout);
router.get('/me', authenticateToken, requireAdmin, getMe);
router.get('/admin-users', authenticateToken, requireAdmin, getAdminUsers);
router.post('/admin-users', authenticateToken, requireAdmin, createAdminUser);
router.put('/admin-users/:id', authenticateToken, requireAdmin, updateAdminUser);
router.patch('/admin-users/:id/status', authenticateToken, requireAdmin, updateAdminUserStatus);
router.delete('/admin-users/:id', authenticateToken, requireAdmin, deleteAdminUser);
router.put('/profile', authenticateToken, requireAdmin, updateAdminProfile);

export default router;

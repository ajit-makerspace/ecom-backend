import express from 'express';
import { login, getMe } from '../../controllers/admin/authController.js';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';

const router = express.Router();

router.post('/login', login);
router.get('/me', authenticateToken, requireAdmin, getMe);

export default router;

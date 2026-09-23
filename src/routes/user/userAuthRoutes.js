import express from 'express';
import { registerUser, loginUser, getCustomerMe } from '../../controllers/user/userAuthController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

// Customer Auth Endpoints
router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/me', authenticateToken, getCustomerMe);

export default router;

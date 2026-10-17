import express from 'express';
import {
  registerUser,
  loginUser,
  getCustomerMe,
  sendLoginOtp,
  verifyLoginOtp,
  sendPasswordResetOtp,
  resetPasswordWithOtp,
} from '../../controllers/user/userAuthController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

// Customer Auth Endpoints
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/send-login-otp', sendLoginOtp);
router.post('/verify-login-otp', verifyLoginOtp);
router.post('/send-reset-otp', sendPasswordResetOtp);
router.post('/reset-password', resetPasswordWithOtp);
router.get('/me', authenticateToken, getCustomerMe);

export default router;

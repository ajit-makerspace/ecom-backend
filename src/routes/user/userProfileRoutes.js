import express from 'express';
import {
  getProfile,
  updateProfile,
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
} from '../../controllers/user/userProfileController.js';
import { authenticateToken, requireCustomer } from '../../middleware/auth.js';

const router = express.Router();

router.get('/profile', authenticateToken, getProfile);
router.put('/profile', authenticateToken, updateProfile);
router.get('/addresses', authenticateToken, getAddresses);
router.post('/addresses', authenticateToken, createAddress);
router.put('/addresses/:id', authenticateToken, updateAddress);
router.delete('/addresses/:id', authenticateToken, deleteAddress);

export default router;

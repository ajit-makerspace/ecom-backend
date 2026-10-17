import express from 'express';
import {
  getProfile,
  updateProfile,
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  getGstProfile,
  saveGstProfile,
  getUserGstNumbers,
  createUserGstNumber,
  updateUserGstNumber,
  deleteUserGstNumber,
  setDefaultGstNumber,
} from '../../controllers/user/userProfileController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

router.get('/profile', authenticateToken, getProfile);
router.put('/profile', authenticateToken, updateProfile);
router.get('/addresses', authenticateToken, getAddresses);
router.post('/addresses', authenticateToken, createAddress);
router.put('/addresses/:id', authenticateToken, updateAddress);
router.delete('/addresses/:id', authenticateToken, deleteAddress);

// Multi-GST Number Management (supported at /api/user/gst-numbers and /api/user/profile/gst-numbers)
router.get(['/gst-numbers', '/profile/gst-numbers'], authenticateToken, getUserGstNumbers);
router.post(['/gst-numbers', '/profile/gst-numbers'], authenticateToken, createUserGstNumber);
router.put(['/gst-numbers/:id', '/profile/gst-numbers/:id'], authenticateToken, updateUserGstNumber);
router.delete(['/gst-numbers/:id', '/profile/gst-numbers/:id'], authenticateToken, deleteUserGstNumber);
router.put(['/gst-numbers/:id/default', '/profile/gst-numbers/:id/default'], authenticateToken, setDefaultGstNumber);

// Backwards-compatible single GST endpoints
router.get(['/gst-profile', '/profile/gst-profile'], authenticateToken, getGstProfile);
router.post(['/gst-profile', '/profile/gst-profile'], authenticateToken, saveGstProfile);

export default router;

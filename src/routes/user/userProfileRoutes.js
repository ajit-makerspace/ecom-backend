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

router.use(authenticateToken);
router.use(requireCustomer);

router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.get('/addresses', getAddresses);
router.post('/addresses', createAddress);
router.put('/addresses/:id', updateAddress);
router.delete('/addresses/:id', deleteAddress);

export default router;

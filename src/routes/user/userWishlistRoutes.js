import express from 'express';
import {
  getWishlist,
  toggleWishlistItem,
  removeWishlistItem,
  syncWishlist,
} from '../../controllers/user/userWishlistController.js';
import { optionalAuth, authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

// Wishlist Endpoints
router.get('/wishlist', optionalAuth, getWishlist);
router.post('/wishlist/toggle', optionalAuth, toggleWishlistItem);
router.delete('/wishlist/items/:productId', optionalAuth, removeWishlistItem);
router.post('/wishlist/sync', authenticateToken, syncWishlist);

export default router;

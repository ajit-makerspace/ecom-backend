import express from 'express';
import {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
} from '../../controllers/user/userCartController.js';
import { optionalAuth } from '../../middleware/auth.js';

const router = express.Router();

// Universal Cart Endpoints (works for both authenticated users & guest sessions)
router.get('/cart', optionalAuth, getCart);
router.post('/cart/items', optionalAuth, addToCart);
router.put('/cart/items/:productId', optionalAuth, updateCartItem);
router.delete('/cart/items/:productId', optionalAuth, removeCartItem);
router.delete('/cart', optionalAuth, clearCart);

export default router;

import express from 'express';
import {
  getStoreProducts,
  getStoreProductById,
  getStoreCategories,
  getStoreKits,
} from '../../controllers/user/userProductController.js';
import {
  getProductReviews,
  addProductReview,
} from '../../controllers/user/userReviewController.js';
import { authenticateToken } from '../../middleware/auth.js';
import { getPublicBanners } from '../../controllers/admin/bannerController.js';
import { getPublicShowcases } from '../../controllers/admin/showcaseController.js';

const router = express.Router();

router.get('/products', getStoreProducts);
router.get('/products/:id', getStoreProductById);
router.get('/products/:id/reviews', getProductReviews);
router.post('/products/:id/reviews', authenticateToken, addProductReview);
router.get('/kits', getStoreKits);
router.get('/categories', getStoreCategories);
router.get('/banners', getPublicBanners);
router.get('/showcases', getPublicShowcases);

export default router;

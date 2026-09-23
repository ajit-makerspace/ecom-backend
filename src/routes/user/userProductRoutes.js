import express from 'express';
import {
  getStoreProducts,
  getStoreProductById,
  getStoreCategories,
  getStoreKits,
} from '../../controllers/user/userProductController.js';
import { getPublicBanners } from '../../controllers/admin/bannerController.js';
import { getPublicShowcases } from '../../controllers/admin/showcaseController.js';

const router = express.Router();

router.get('/products', getStoreProducts);
router.get('/products/:id', getStoreProductById);
router.get('/kits', getStoreKits);
router.get('/categories', getStoreCategories);
router.get('/banners', getPublicBanners);
router.get('/showcases', getPublicShowcases);

export default router;

import express from 'express';
import {
  getStoreProducts,
  getStoreProductById,
  getStoreCategories,
  getStoreKits,
} from '../../controllers/user/userProductController.js';
import { getPublicBanners } from '../../controllers/admin/bannerController.js';
import { getPublicShowcases } from '../../controllers/admin/showcaseController.js';
import {getUserBrandLogos} from '../../controllers/admin/brandRibbonController.js';

const router = express.Router();

router.get('/products', getStoreProducts);
router.get('/products/:id', getStoreProductById);
router.get('/kits', getStoreKits);
router.get('/categories', getStoreCategories);
router.get('/banners', getPublicBanners);
router.get('/showcases', getPublicShowcases);
router.get('/brand-logos', getUserBrandLogos);

export default router;

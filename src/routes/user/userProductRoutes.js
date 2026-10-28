import express from 'express';
import {
  getStoreProducts,
  getStoreProductById,
  getStoreCategories,
  getStoreKits,
  searchStoreProducts,
  getStoreContactInfo,
} from '../../controllers/user/userProductController.js';
import {
  getProductReviews,
  addProductReview,
} from '../../controllers/user/userReviewController.js';
import { authenticateToken } from '../../middleware/auth.js';
import { getPublicBanners } from '../../controllers/admin/bannerController.js';
import { getPublicShowcases } from '../../controllers/admin/showcaseController.js';
import {getBrandFilterOptions, getFilteredBrandLogos, getUserBrandLogos, updateBrandLogo} from '../../controllers/admin/brandRibbonController.js';
import { getUserCustomerLogos } from '../../controllers/admin/customerRibbonController.js';

const router = express.Router();

router.get('/search', searchStoreProducts);
router.get('/products/search', searchStoreProducts);
router.get('/products', getStoreProducts);
router.get('/products/:id', getStoreProductById);
router.get('/products/:id/reviews', getProductReviews);
router.post('/products/:id/reviews', authenticateToken, addProductReview);
router.get('/kits', getStoreKits);
router.get('/categories', getStoreCategories);
router.get('/banners', getPublicBanners);
router.get('/showcases', getPublicShowcases);
router.get('/brand-logos', getUserBrandLogos);
router.get('/customer-logos', getUserCustomerLogos);
router.put('/brand-logos/:id', updateBrandLogo);
router.get('/brand-logos/filter', getFilteredBrandLogos);
router.get('/brand-logos/filter-options', getBrandFilterOptions);
router.get('/contact-info', getStoreContactInfo);
router.get('/warehouse/default', getStoreContactInfo);

export default router;

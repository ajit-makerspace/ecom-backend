import express from 'express';
import {
  getBrandLogos,
  getBrandLogoById,
  createBrandLogo,
  updateBrandLogo,
  deleteBrandLogo,
} from '../../controllers/admin/brandRibbonController.js';

import { authenticateToken, requireAdmin } from '../../middleware/auth.js';

const router = express.Router();


router.use(authenticateToken);
router.use(requireAdmin);

// Keep this before /:id.


router.get('/brand-logos', getBrandLogos);
router.get('/:id', getBrandLogoById);

router.post('/brand-logos', createBrandLogo);
router.put('/brand-logos/:id', updateBrandLogo);
router.patch('/brand-logos/:id', updateBrandLogo);
router.delete('/brand-logos/:id', deleteBrandLogo);

export default router;
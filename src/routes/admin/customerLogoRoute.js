
import express from 'express';

// import {
//   getCustomerLogos,
//   getCustomerLogoById,
//   createCustomerLogo,
//   updateCustomerLogo,
//   deleteCustomerLogo,
// } from '../../controllers/admin/customerLogoController.js';

import {
  authenticateToken,
  requireAdmin,
} from '../../middleware/auth.js';
import { getCustomerLogos, getCustomerLogoById,
   createCustomerLogo,
   updateCustomerLogo,
   deleteCustomerLogo, } from '../../controllers/admin/customerRibbonController.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireAdmin);

// Get all customer logos
router.get('/customer-logos', getCustomerLogos);

// Create a customer logo
router.post('/customer-logos', createCustomerLogo);

// Get one customer logo
router.get('/customer-logos/:id', getCustomerLogoById);

// Update a customer logo
router.put('/customer-logos/:id', updateCustomerLogo);
router.patch('/customer-logos/:id', updateCustomerLogo);

// Soft-delete a customer logo
router.delete('/customer-logos/:id', deleteCustomerLogo);

export default router;

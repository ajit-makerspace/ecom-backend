import express from 'express';
import {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkImportProducts,
} from '../../controllers/admin/productController.js';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireAdmin);

router.get('/products', getProducts);
router.post('/products', createProduct);
router.post('/products/bulk-import', bulkImportProducts);
router.put('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);

export default router;

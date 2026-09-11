import express from 'express';
import {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkImportProducts,
} from '../../controllers/admin/productController.js';

const router = express.Router();

router.get('/products', getProducts);
router.post('/products', createProduct);
router.post('/products/bulk-import', bulkImportProducts);
router.put('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);

export default router;

import express from 'express';
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getSubCategories,
  createSubCategory,
  updateSubCategory,
  deleteSubCategory,
  bulkImportCategories,
  bulkImportSubCategories,
} from '../../controllers/admin/categoryController.js';

const router = express.Router();

// Main Category Routes
router.get('/categories', getCategories);
router.post('/categories', createCategory);
router.post('/categories/bulk-import', bulkImportCategories);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

// Sub Category Routes
router.get('/subcategories', getSubCategories);
router.post('/subcategories', createSubCategory);
router.post('/subcategories/bulk-import', bulkImportSubCategories);
router.put('/subcategories/:id', updateSubCategory);
router.delete('/subcategories/:id', deleteSubCategory);

export default router;

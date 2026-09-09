const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');

// Main Category Routes
router.get('/categories', categoryController.getCategories);
router.post('/categories', categoryController.createCategory);
router.put('/categories/:id', categoryController.updateCategory);
router.delete('/categories/:id', categoryController.deleteCategory);

// Sub Category Routes
router.get('/subcategories', categoryController.getSubCategories);
router.post('/subcategories', categoryController.createSubCategory);
router.delete('/subcategories/:id', categoryController.deleteSubCategory);

module.exports = router;

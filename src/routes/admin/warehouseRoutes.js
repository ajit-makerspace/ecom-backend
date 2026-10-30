import express from 'express';
import {
  getWarehouses,
  getDefaultWarehouse,
  createWarehouse,
  updateWarehouse,
  setDefaultWarehouse,
  deleteWarehouse,
} from '../../controllers/admin/warehouseController.js';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';

const router = express.Router();

// Public / Default warehouse endpoint
router.get('/warehouses/default', getDefaultWarehouse);

// Admin-protected CRUD endpoints
router.get('/warehouses', authenticateToken, requireAdmin, getWarehouses);
router.post('/warehouses', authenticateToken, requireAdmin, createWarehouse);
router.put('/warehouses/:id', authenticateToken, requireAdmin, updateWarehouse);
router.patch('/warehouses/:id/default', authenticateToken, requireAdmin, setDefaultWarehouse);
router.delete('/warehouses/:id', authenticateToken, requireAdmin, deleteWarehouse);

export default router;

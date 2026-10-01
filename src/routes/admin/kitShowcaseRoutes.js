import express from 'express';
import {
  getKitShowcases,
  creatKitShowcase,
  updateKitShowcase,
  deleteKitShowcase,
} from '../../controllers/admin/kitsShowcaseController.js';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';
 
const router = express.Router();
 
router.use(authenticateToken);
router.use(requireAdmin);
 
router.get('/kit-showcases', getKitShowcases);
router.post('/kit-showcases', creatKitShowcase);
router.put('/kit-showcases/:id', updateKitShowcase);
router.delete('/kit-showcases/:id', deleteKitShowcase);
 
export default router;
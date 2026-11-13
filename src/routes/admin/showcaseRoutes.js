import express from 'express';
import {
  getShowcases,
  createShowcase,
  updateShowcase,
  deleteShowcase,
} from '../../controllers/admin/showcaseController.js';
import { authenticateToken, requireRole } from '../../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireRole([1, 5]));

router.get('/showcases', getShowcases);
router.post('/showcases', createShowcase);
router.put('/showcases/:id', updateShowcase);
router.delete('/showcases/:id', deleteShowcase);

export default router;

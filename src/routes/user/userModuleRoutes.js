import express from 'express';
import {
  
} from '../../controllers/admin/moduleController.js';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';
import { getUserModules, getProductsAsPerModule } from '../../controllers/user/userModuleController.js';

const router = express.Router();

// router.get('/modules', getProductsAsPerModule);
   router.get('/modules/:moduleId/products', getProductsAsPerModule);
   router.get('/modules', getUserModules);
// router.use(authenticateToken);
// router.use(requireAdmin);




export default router;
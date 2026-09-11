import express from 'express';
import {
  getModules,
  createModule,
  updateModule,
  deleteModule,
  bulkImportModules,
} from '../../controllers/admin/moduleController.js';

const router = express.Router();

router.get('/modules', getModules);
router.post('/modules', createModule);
router.post('/modules/bulk-import', bulkImportModules);
router.put('/modules/:id', updateModule);
router.delete('/modules/:id', deleteModule);

export default router;

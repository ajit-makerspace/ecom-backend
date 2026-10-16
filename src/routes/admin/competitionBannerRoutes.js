
import express from 'express';
import {
  multerUpload,
  handleSingleUpload,
} from '../../controllers/uploadController.js';


import {
  authenticateToken,
  requireAdmin,
} from '../../middleware/auth.js';
import { createCompetition, deleteCompetition, getCompetitionBanners, getCompetitionById, getCompetitions, updateCompetition } from '../../controllers/admin/competitionBannerController.js';
import { createCompetitionBanner } from '../../controllers/admin/competitionBannerController.js';
import { updateCompetitionBanner } from '../../controllers/admin/competitionBannerController.js';
import { updateCompetitionBannerStatus } from '../../controllers/admin/competitionBannerController.js';
import { deleteCompetitionBanner } from '../../controllers/admin/competitionBannerController.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireAdmin);
router.post(
  '/upload',
  multerUpload.single('file'),
  handleSingleUpload
);

// For banners
router.get('/competition-banners', getCompetitionBanners);
router.post('/competition-banners', createCompetitionBanner);
router.put('/competition-banners/:id', updateCompetitionBanner);
router.patch('/competition-banners/:id/status', updateCompetitionBannerStatus);
router.delete('/competition-banners/:id', deleteCompetitionBanner);


// For competitions
router.get("/competitions", getCompetitions);
router.get("/competitions/:id", getCompetitionById);
router.post("/competitions", createCompetition);
router.put("/competitions/:id", updateCompetition);
router.delete("/competitions/:id", deleteCompetition);



export default router;

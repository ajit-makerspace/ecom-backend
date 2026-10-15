
import express from 'express';
import {
  getActiveCompetitionBanner,
  getCompetitionById,
  getCompetitions,
} from '../../controllers/admin/competitionBannerController.js';

const router = express.Router();

router.get('/competition/active', getActiveCompetitionBanner);


router.get('/competitions', getCompetitions);
router.get('/competitions/:id', getCompetitionById);

export default router;


import express from "express";

import {
  getActiveMaterials,
  getActiveMaterialById,
} from "../../controllers/user/userMaterialController.js";

const router = express.Router();

// GET ALL ACTIVE MATERIALS
router.get("/materials", getActiveMaterials);

// GET ACTIVE MATERIAL BY ID
router.get("/materials/:id", getActiveMaterialById);

export default router;

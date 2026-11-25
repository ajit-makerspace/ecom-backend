import express from "express";

import {
  createMaterial,
  getAllMaterials,
  getMaterialById,
  updateMaterial,
  updateMaterialStatus,
} from "../../controllers/admin/printMaterialController.js";
import {
  createAdditionalCharge,
  getAllAdditionalCharges,
  getAdditionalChargeById,
  updateAdditionalCharge,
  updateAdditionalChargeStatus,
} from "../../controllers/admin/printAdditionalChargeController.js";

import { authenticateToken, requireRole } from '../../middleware/auth.js';
import { getPrintPricing, updatePrintPricing } from "../../controllers/admin/printPricingController.js";

const router = express.Router();

router.use(authenticateToken);
router.use(requireRole([1, 4]));
// Add your existing admin authentication middleware here.

router.post("/materials", createMaterial);
router.get("/materials", getAllMaterials);
router.get("/materials/:id", getMaterialById);
router.put("/materials/:id", updateMaterial);
router.patch("/materials/:id/status", updateMaterialStatus);



router.get("/print-pricing", getPrintPricing);
router.put("/print-pricing", updatePrintPricing);


// ADDITIONAL CHARGES
router.post("/additional-charges", createAdditionalCharge);
router.get("/additional-charges", getAllAdditionalCharges);
router.get("/additional-charges/:id", getAdditionalChargeById);
router.put("/additional-charges/:id", updateAdditionalCharge);
router.patch(
  "/additional-charges/:id/status",
  updateAdditionalChargeStatus
);

export default router;
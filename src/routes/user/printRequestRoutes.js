import express from "express";
import { authenticateToken } from "../../middleware/auth.js";

// import {
//   printMulterUpload,
//   submitPrintRequest,
//   getMyPrintRequests,
// } from "../../controllers/user/printRequestController.js";

const router = express.Router();

// const uploadFields = printMulterUpload.fields([
//   { name: "model", maxCount: 1 },
//   { name: "supportFiles", maxCount: 15 },
// ]);

// router.post(
//   "/print-requests",
//   authenticateToken,
//   uploadFields,
//   submitPrintRequest
// );

// router.get(
//   "/print-requests",
//   authenticateToken,
//   getMyPrintRequests
// );

export default router;

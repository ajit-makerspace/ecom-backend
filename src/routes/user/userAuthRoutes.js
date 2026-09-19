import express from 'express';
import { registerUser, loginUser } from '../../controllers/user/userAuthController.js';

const router = express.Router();

// Customer Auth Endpoints
router.post('/register', registerUser);
router.post('/login', loginUser);

export default router;

import express from 'express';
import { getStoreChatbotIntents } from '../../controllers/user/userChatbotController.js';

const router = express.Router();

router.get('/chatbot-intents', getStoreChatbotIntents);

export default router;

import express from 'express';
import {
  getAdminChatbotIntents,
  createChatbotIntent,
  updateChatbotIntent,
  deleteChatbotIntent,
  toggleChatbotIntentStatus,
} from '../../controllers/admin/adminChatbotController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

router.get('/chatbot-intents', authenticateToken, getAdminChatbotIntents);
router.post('/chatbot-intents', authenticateToken, createChatbotIntent);
router.put('/chatbot-intents/:id', authenticateToken, updateChatbotIntent);
router.delete('/chatbot-intents/:id', authenticateToken, deleteChatbotIntent);
router.patch('/chatbot-intents/:id/status', authenticateToken, toggleChatbotIntentStatus);

export default router;

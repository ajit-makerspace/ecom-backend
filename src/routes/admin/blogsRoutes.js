import express from 'express';

import {
  authenticateToken,
  requireAdmin,
} from '../../middleware/auth.js';

import {
  getBlogs,
  getBlogById,
  createBlog,
  updateBlog,
  deleteBlog,
} from '../../controllers/admin/adminBlogsController.js';

const router = express.Router();

// Protect all blog routes
router.use(authenticateToken);
router.use(requireAdmin);

// Blog CRUD routes
router.get('/blogs', getBlogs);
router.get('/blogs/:id', getBlogById);
router.post('/blogs', createBlog);
router.put('/blogs/:id', updateBlog);
router.delete('/blogs/:id', deleteBlog);

export default router;

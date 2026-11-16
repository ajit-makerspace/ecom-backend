import express from 'express';
import { getUserBlogById, getUserBlogs } from '../../controllers/user/userBlogController.js';


const router = express.Router();

// Blog Endpoints
router.get('/blogs', getUserBlogs);
router.get('/blogs/:id', getUserBlogById);



export default router;

import db from '../../config/db.js';

// Same shape as the admin controller, so the storefront pages can reuse
// the same field names (mainHeading, subHeading, description, ...).
const formatBlog = (row) => ({
  id: String(row.id),
  mainHeading: row.main_heading,
  subHeading: row.sub_heading,
  lastUpdate: row.last_update,
  readingTime: row.reading_time,
  description: row.description,
  imageUrl: row.image_url,
  // `sections` is a jsonb column: pg already returns it parsed.
  sections: Array.isArray(row.sections) ? row.sections : [],
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const BLOG_COLUMNS = `
  id,
  main_heading,
  sub_heading,
  last_update,
  reading_time,
  description,
  image_url,
  sections,
  is_active,
  created_at,
  updated_at
`;

/**
 * GET /api/user/blogs
 * Published blogs only, newest first.
 */
export const getUserBlogs = async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT ${BLOG_COLUMNS}
      FROM blogs
      WHERE is_active = TRUE
      ORDER BY created_at DESC, id DESC
    `);

    return res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows.map(formatBlog),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/user/blogs/:id
 * A single published blog. Drafts return 404, same as a missing blog.
 */
export const getUserBlogById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blog ID.',
      });
    }

    const result = await db.query(
      `
        SELECT ${BLOG_COLUMNS}
        FROM blogs
        WHERE id = $1 AND is_active = TRUE
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blog not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: formatBlog(result.rows[0]),
    });
  } catch (error) {
    next(error);
  }
};
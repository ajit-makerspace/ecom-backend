import db from '../../config/db.js';

/**
 * Ensure the product_reviews table exists in PostgreSQL
 */
export async function ensureReviewsTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS product_reviews (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        user_name VARCHAR(150),
        user_email VARCHAR(255),
        rating NUMERIC(2, 1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
        title VARCHAR(255),
        comment TEXT NOT NULL,
        status SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_product_reviews_prod ON product_reviews(product_id);
      CREATE INDEX IF NOT EXISTS idx_product_reviews_user ON product_reviews(user_id);
    `);

    // Sync products.reviews_count and products.rating with real approved reviews
    await db.query(`
      UPDATE products p
      SET 
        reviews_count = COALESCE(sub.cnt, 0),
        rating = COALESCE(sub.avg_rating, 0.0)
      FROM (
        SELECT 
          product_id, 
          COUNT(*)::int AS cnt, 
          ROUND(AVG(rating), 1) AS avg_rating
        FROM product_reviews
        WHERE status = 1
        GROUP BY product_id
      ) sub
      WHERE p.id = sub.product_id;

      UPDATE products
      SET reviews_count = 0, rating = 0.0
      WHERE id NOT IN (SELECT DISTINCT product_id FROM product_reviews WHERE status = 1);
    `);
  } catch (err) {
    console.error('Error ensuring product_reviews table:', err.message);
  }
}

/**
 * GET /api/user/products/:id/reviews
 * Fetch all approved reviews for a product along with aggregated statistics
 */
export async function getProductReviews(req, res) {
  try {
    const { id } = req.params;

    // Resolve product ID by ID or slug
    const prodRes = await db.query(
      `SELECT id, name, rating, reviews_count AS "reviewsCount"
       FROM products
       WHERE (id::text = $1 OR slug = $1) AND status = 1
       LIMIT 1`,
      [id]
    );

    if (prodRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const product = prodRes.rows[0];
    const productId = product.id;

    // Fetch reviews
    const { rows: reviews } = await db.query(
      `SELECT 
        r.id,
        r.product_id AS "productId",
        r.user_id AS "userId",
        COALESCE(r.user_name, 'Verified Customer') AS "userName",
        COALESCE(r.title, 'Verified Review') AS "title",
        r.rating,
        r.comment,
        r.created_at AS "createdAt"
       FROM product_reviews r
       WHERE r.product_id = $1 AND r.status = 1
       ORDER BY r.created_at DESC`,
      [productId]
    );

    // Aggregate stats from DB reviews
    const totalReviews = reviews.length;
    const averageRating = totalReviews > 0
      ? parseFloat((reviews.reduce((acc, r) => acc + parseFloat(r.rating || 0), 0) / totalReviews).toFixed(1))
      : 0.0;

    const ratingBreakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    reviews.forEach((r) => {
      const rounded = Math.round(parseFloat(r.rating || 0));
      if (ratingBreakdown[rounded] !== undefined) {
        ratingBreakdown[rounded] += 1;
      }
    });

    return res.json({
      success: true,
      productId,
      reviews,
      totalReviews,
      averageRating,
      ratingBreakdown,
    });
  } catch (err) {
    console.error('Get Product Reviews Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load product reviews.' });
  }
}

/**
 * POST /api/user/products/:id/reviews
 * Submit a customer review (Requires Authentication via verify token)
 */
export async function addProductReview(req, res) {
  try {
    const { id } = req.params;
    const { rating, comment, title } = req.body;

    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please sign in to submit a review.',
      });
    }

    const numRating = parseFloat(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid star rating between 1 and 5.',
      });
    }

    if (!comment || !comment.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide review comments.',
      });
    }

    // Resolve product ID by ID or slug
    const prodRes = await db.query(
      `SELECT id, name FROM products WHERE (id::text = $1 OR slug = $1) AND status = 1 LIMIT 1`,
      [id]
    );

    if (prodRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const product = prodRes.rows[0];
    const productId = product.id;

    // Reviewer display name
    const reviewerName =
      [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') ||
      req.user.name ||
      req.user.email?.split('@')[0] ||
      'Verified Customer';

    const reviewTitle = (title && title.trim()) || 'Verified Review';

    // Insert new review
    const { rows: inserted } = await db.query(
      `INSERT INTO product_reviews (
        product_id,
        user_id,
        user_name,
        user_email,
        rating,
        title,
        comment,
        status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NOW(), NOW())
      RETURNING 
        id,
        product_id AS "productId",
        user_id AS "userId",
        user_name AS "userName",
        title,
        rating,
        comment,
        created_at AS "createdAt"`,
      [
        productId,
        req.user.id,
        reviewerName,
        req.user.email || '',
        numRating,
        reviewTitle,
        comment.trim(),
      ]
    );

    const newReview = inserted[0];

    // Recalculate average rating & reviews_count for the product
    const statsRes = await db.query(
      `SELECT 
        COUNT(*)::int AS count, 
        ROUND(AVG(rating)::numeric, 1) AS avg_rating
       FROM product_reviews
       WHERE product_id = $1 AND status = 1`,
      [productId]
    );

    const newCount = statsRes.rows[0]?.count || 1;
    const newAvgRating = parseFloat(statsRes.rows[0]?.avg_rating || numRating);

    // Update product table with real aggregates
    await db.query(
      `UPDATE products 
       SET rating = $1, reviews_count = $2, updated_at = NOW() 
       WHERE id = $3`,
      [newAvgRating, newCount, productId]
    );

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your review has been submitted successfully.',
      review: newReview,
      productStats: {
        rating: newAvgRating,
        reviewsCount: newCount,
      },
    });
  } catch (err) {
    console.error('Submit Product Review Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to submit review. Please try again.',
    });
  }
}

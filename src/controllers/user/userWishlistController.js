import db from '../../config/db.js';

/**
 * Get or create active wishlist for user
 */
async function getOrCreateWishlist(userId) {
  if (!userId) return null;

  let { rows } = await db.query(
    'SELECT id, user_id, status FROM wishlists WHERE user_id = $1 AND status = 1 ORDER BY updated_at DESC LIMIT 1',
    [userId]
  );

  if (rows.length > 0) {
    return rows[0];
  }

  // Create new active wishlist
  const newWishlist = await db.query(
    `INSERT INTO wishlists (user_id, status, created_at, updated_at)
     VALUES ($1, 1, NOW(), NOW())
     RETURNING id, user_id, status`,
    [userId]
  );

  return newWishlist.rows[0];
}

/**
 * GET /api/user/wishlist
 * Fetch customer's active wishlist with full product details
 */
export const getWishlist = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.json({ success: true, wishlistId: null, items: [], productIds: [] });
    }

    const wishlist = await getOrCreateWishlist(userId);
    if (!wishlist) {
      return res.json({ success: true, wishlistId: null, items: [], productIds: [] });
    }

    const { rows } = await db.query(
      `SELECT 
         wi.id AS wishlist_item_id,
         wi.product_id,
         wi.created_at AS added_at,
         p.id,
         p.name,
         p.slug,
         p.price,
         p.old_price AS "oldPrice",
         p.rating,
         p.reviews_count AS "reviewsCount",
         p.stock,
         p.sku,
         p.category_id,
         p.status,
         c.name AS "categoryName",
         COALESCE(
           p.image_url,
           (SELECT file_url FROM product_images WHERE product_id = p.id AND status = 1 ORDER BY is_primary DESC, id ASC LIMIT 1),
           '/placeholder-product.png'
         ) AS image
       FROM wishlist_items wi
       JOIN products p ON wi.product_id = p.id
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE wi.wishlist_id = $1 AND p.status = 1
       ORDER BY wi.created_at DESC`,
      [wishlist.id]
    );

    return res.json({
      success: true,
      wishlistId: wishlist.id,
      items: rows,
      productIds: rows.map((r) => r.id),
      totalCount: rows.length,
    });
  } catch (err) {
    console.error('getWishlist error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load wishlist.' });
  }
};

/**
 * POST /api/user/wishlist/toggle
 * Toggle product in wishlist (Add if not present, remove if present)
 */
export const toggleWishlistItem = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { productId, productVariantId } = req.body;

    if (!userId) {
      return res.json({
        success: true,
        isGuest: true,
        message: 'Wishlist updated for guest.',
      });
    }

    const prodIdNum = parseInt(productId, 10);
    if (!prodIdNum || isNaN(prodIdNum)) {
      return res.status(400).json({ success: false, message: 'Valid productId is required.' });
    }

    const wishlist = await getOrCreateWishlist(userId);

    // Check if product already exists in wishlist
    const existing = await db.query(
      'SELECT id FROM wishlist_items WHERE wishlist_id = $1 AND product_id = $2',
      [wishlist.id, prodIdNum]
    );

    let inWishlist = false;
    let message = '';

    if (existing.rows.length > 0) {
      // Remove from wishlist
      await db.query('DELETE FROM wishlist_items WHERE id = $1', [existing.rows[0].id]);
      await db.query('UPDATE wishlists SET updated_at = NOW() WHERE id = $1', [wishlist.id]);
      inWishlist = false;
      message = 'Item removed from your saved wishlist.';
    } else {
      // Add to wishlist
      await db.query(
        `INSERT INTO wishlist_items (wishlist_id, product_id, product_variant_id, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [wishlist.id, prodIdNum, productVariantId || null]
      );
      await db.query('UPDATE wishlists SET updated_at = NOW() WHERE id = $1', [wishlist.id]);
      inWishlist = true;
      message = 'Item added to your saved wishlist!';
    }

    // Return updated product IDs list
    const { rows } = await db.query(
      'SELECT product_id FROM wishlist_items WHERE wishlist_id = $1',
      [wishlist.id]
    );

    return res.json({
      success: true,
      inWishlist,
      message,
      productIds: rows.map((r) => r.product_id),
    });
  } catch (err) {
    console.error('toggleWishlistItem error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update wishlist.' });
  }
};

/**
 * DELETE /api/user/wishlist/items/:productId
 * Explicitly remove item from wishlist
 */
export const removeWishlistItem = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { productId } = req.params;

    if (!userId) {
      return res.json({
        success: true,
        isGuest: true,
        message: 'Item removed from guest wishlist.',
      });
    }

    const prodIdNum = parseInt(productId, 10);
    const wishlist = await getOrCreateWishlist(userId);

    await db.query('DELETE FROM wishlist_items WHERE wishlist_id = $1 AND product_id = $2', [wishlist.id, prodIdNum]);
    await db.query('UPDATE wishlists SET updated_at = NOW() WHERE id = $1', [wishlist.id]);

    const { rows } = await db.query(
      'SELECT product_id FROM wishlist_items WHERE wishlist_id = $1',
      [wishlist.id]
    );

    return res.json({
      success: true,
      message: 'Item removed from wishlist.',
      productIds: rows.map((r) => r.product_id),
    });
  } catch (err) {
    console.error('removeWishlistItem error:', err);
    return res.status(500).json({ success: false, message: 'Failed to remove wishlist item.' });
  }
};

/**
 * POST /api/user/wishlist/sync
 * Sync guest localStorage product IDs to user database wishlist upon login
 */
export const syncWishlist = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { productIds } = req.body;

    if (!userId || !Array.isArray(productIds) || productIds.length === 0) {
      return res.json({ success: true, message: 'Nothing to sync.' });
    }

    const wishlist = await getOrCreateWishlist(userId);

    for (const pid of productIds) {
      const pNum = parseInt(pid, 10);
      if (!pNum) continue;

      const exists = await db.query(
        'SELECT id FROM wishlist_items WHERE wishlist_id = $1 AND product_id = $2',
        [wishlist.id, pNum]
      );

      if (exists.rows.length === 0) {
        await db.query(
          'INSERT INTO wishlist_items (wishlist_id, product_id, created_at) VALUES ($1, $2, NOW())',
          [wishlist.id, pNum]
        );
      }
    }

    await db.query('UPDATE wishlists SET updated_at = NOW() WHERE id = $1', [wishlist.id]);

    const { rows } = await db.query(
      'SELECT product_id FROM wishlist_items WHERE wishlist_id = $1',
      [wishlist.id]
    );

    return res.json({
      success: true,
      productIds: rows.map((r) => r.product_id),
    });
  } catch (err) {
    console.error('syncWishlist error:', err);
    return res.status(500).json({ success: false, message: 'Failed to sync wishlist.' });
  }
};

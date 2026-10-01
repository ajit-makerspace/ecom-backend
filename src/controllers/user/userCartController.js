import db from '../../config/db.js';

/**
 * Resolve or create active cart for logged-in user or guest visitor
 */
export const getOrCreateCart = async (req) => {
  const userId = req.user?.id || null;
  const rawSessionId = req.headers['x-session-id'] || req.query?.sessionId || req.body?.sessionId || null;
  const sessionId = rawSessionId && typeof rawSessionId === 'string' ? rawSessionId.trim() : null;

  // Case 1: Authenticated User
  if (userId) {
    let { rows } = await db.query(
      'SELECT id, users_id, status FROM carts WHERE users_id = $1 AND status = 1 ORDER BY updated_at DESC LIMIT 1',
      [userId]
    );

    let cart;
    if (rows.length > 0) {
      cart = rows[0];

      // Merge guest cart if user had items before logging in
      if (sessionId) {
        const guestCartRes = await db.query(
          'SELECT id FROM carts WHERE session_id = $1 AND users_id IS NULL AND status = 1 AND id != $2',
          [sessionId, cart.id]
        );

        if (guestCartRes.rows.length > 0) {
          const guestCartId = guestCartRes.rows[0].id;
          const guestItems = await db.query(
            'SELECT product_id, quantity FROM cart_items WHERE cart_id = $1',
            [guestCartId]
          );

          for (const item of guestItems.rows) {
            await db.query(
              `INSERT INTO cart_items (cart_id, product_id, quantity, created_at, updated_at)
               VALUES ($1, $2, $3, NOW(), NOW())
               ON CONFLICT (cart_id, product_id)
               DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = NOW()`,
              [cart.id, item.product_id, item.quantity]
            );
          }

          // Clean up guest cart now that items are merged into user's cart
          await db.query('DELETE FROM cart_items WHERE cart_id = $1', [guestCartId]);
          await db.query('DELETE FROM carts WHERE id = $1', [guestCartId]);
        }
      }
    } else {
      // Check if user has an existing guest cart from this browser session to claim
      if (sessionId) {
        const guestCartRes = await db.query(
          'SELECT id FROM carts WHERE session_id = $1 AND users_id IS NULL AND status = 1 ORDER BY updated_at DESC LIMIT 1',
          [sessionId]
        );

        if (guestCartRes.rows.length > 0) {
          const claimedCart = await db.query(
            'UPDATE carts SET users_id = $1, updated_at = NOW() WHERE id = $2 RETURNING id, users_id, status',
            [userId, guestCartRes.rows[0].id]
          );
          return claimedCart.rows[0];
        }
      }

      const newCart = await db.query(
        'INSERT INTO carts (users_id, session_id, status, created_at, updated_at) VALUES ($1, $2, 1, NOW(), NOW()) RETURNING id, users_id, status',
        [userId, sessionId]
      );
      cart = newCart.rows[0];
    }

    return cart;
  }

  // Case 2: Guest Visitor with Session ID
  const effectiveSessionId = sessionId || `guest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  let { rows } = await db.query(
    'SELECT id, users_id, status FROM carts WHERE session_id = $1 AND users_id IS NULL AND status = 1 ORDER BY updated_at DESC LIMIT 1',
    [effectiveSessionId]
  );

  if (rows.length > 0) {
    return { ...rows[0], effectiveSessionId };
  }

  const newGuestCart = await db.query(
    'INSERT INTO carts (users_id, session_id, status, created_at, updated_at) VALUES (NULL, $1, 1, NOW(), NOW()) RETURNING id, users_id, status',
    [effectiveSessionId]
  );

  return { ...newGuestCart.rows[0], effectiveSessionId };
};

/**
 * Fetch cart items with full product details directly from PostgreSQL
 */
export const fetchCartWithProducts = async (cartId) => {
  const { rows } = await db.query(
    `SELECT 
      ci.id AS "cartItemId",
      ci.quantity,
      ci.created_at AS "addedAt",
      p.id,
      p.name,
      p.slug,
      p.sku,
      p.price,
      p.old_price AS "oldPrice",
      p.stock,
      p.rating,
      p.reviews_count AS "reviewsCount",
      p.brand,
      p.is_featured AS "isFeatured",
      p.is_new AS "isNew",
      p.badge,
      p.image_url AS "image",
      p.images,
      c.name AS "categoryName",
      c.slug AS "categorySlug"
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE ci.cart_id = $1 AND p.status = 1
    ORDER BY COALESCE(ci.updated_at, ci.created_at, NOW()) DESC, ci.id DESC`,
    [cartId]
  );

  const items = rows.map((r) => {
    let imagesArr = [];
    if (Array.isArray(r.images)) {
      imagesArr = r.images;
    } else if (typeof r.images === 'string') {
      try { imagesArr = JSON.parse(r.images); } catch (e) { imagesArr = []; }
    }
    if (imagesArr.length === 0 && r.image) {
      imagesArr = [r.image];
    }

    return {
      cartItemId: r.cartItemId,
      quantity: r.quantity,
      addedAt: r.addedAt,
      product: {
        id: r.id,
        name: r.name,
        slug: r.slug,
        sku: r.sku,
        price: parseFloat(r.price || 0),
        oldPrice: r.oldPrice ? parseFloat(r.oldPrice) : null,
        stock: r.stock,
        rating: parseFloat(r.rating || 5.0),
        reviewsCount: parseInt(r.reviewsCount || 0, 10),
        brand: r.brand,
        isFeatured: r.isFeatured,
        isNew: r.isNew,
        badge: r.badge,
        image: r.image || '/products/product-electronics.png',
        images: imagesArr,
        categoryName: r.categoryName,
        categorySlug: r.categorySlug,
      },
    };
  });

  const cartCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = items.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);

  return {
    items,
    cartCount,
    cartSubtotal: parseFloat(cartSubtotal.toFixed(2)),
  };
};

/**
 * GET /api/user/cart
 * Returns the current active cart from the database
 */
export const getCart = async (req, res) => {
  try {
    const cart = await getOrCreateCart(req);
    const cartData = await fetchCartWithProducts(cart.id);

    return res.json({
      success: true,
      cartId: cart.id,
      sessionId: cart.effectiveSessionId || cart.session_id,
      items: cartData.items,
      cartCount: cartData.cartCount,
      cartSubtotal: cartData.cartSubtotal,
    });
  } catch (err) {
    console.error('Get Cart Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch cart from database.' });
  }
};

/**
 * POST /api/user/cart/items
 * Adds a product to the cart directly in PostgreSQL
 */
export const addToCart = async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;
    const qty = parseInt(quantity, 10) || 1;

    if (!productId) {
      return res.status(400).json({ success: false, message: 'Product ID is required.' });
    }

    if (qty <= 0) {
      return res.status(400).json({ success: false, message: 'Quantity must be at least 1.' });
    }

    // Verify product exists and is active
    const prodRes = await db.query('SELECT id, name, status, price FROM products WHERE id = $1', [productId]);
    if (prodRes.rows.length === 0 || prodRes.rows[0].status !== 1) {
      return res.status(404).json({ success: false, message: 'Product not found or unavailable.' });
    }

    const cart = await getOrCreateCart(req);

    // Upsert into cart_items
    await db.query(
      `INSERT INTO cart_items (cart_id, product_id, quantity, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (cart_id, product_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = NOW()`,
      [cart.id, productId, qty]
    );

    // Update cart timestamp
    await db.query('UPDATE carts SET updated_at = NOW() WHERE id = $1', [cart.id]);

    const updatedCart = await fetchCartWithProducts(cart.id);

    return res.status(201).json({
      success: true,
      message: 'Product added to cart in database.',
      cartId: cart.id,
      sessionId: cart.effectiveSessionId || cart.session_id,
      items: updatedCart.items,
      cartCount: updatedCart.cartCount,
      cartSubtotal: updatedCart.cartSubtotal,
    });
  } catch (err) {
    console.error('Add to Cart Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to add item to database cart.' });
  }
};

/**
 * PUT /api/user/cart/items/:productId
 * Updates quantity or applies delta directly in PostgreSQL
 */
export const updateCartItem = async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity, delta } = req.body;

    const cart = await getOrCreateCart(req);

    if (quantity !== undefined) {
      const newQty = parseInt(quantity, 10);
      if (newQty <= 0) {
        await db.query('DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cart.id, productId]);
      } else {
        await db.query(
          'UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE cart_id = $2 AND product_id = $3',
          [newQty, cart.id, productId]
        );
      }
    } else if (delta !== undefined) {
      const deltaNum = parseInt(delta, 10);
      const existing = await db.query(
        'SELECT quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2',
        [cart.id, productId]
      );

      if (existing.rows.length > 0) {
        const nextQty = existing.rows[0].quantity + deltaNum;
        if (nextQty <= 0) {
          await db.query('DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cart.id, productId]);
        } else {
          await db.query(
            'UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE cart_id = $2 AND product_id = $3',
            [nextQty, cart.id, productId]
          );
        }
      }
    }

    await db.query('UPDATE carts SET updated_at = NOW() WHERE id = $1', [cart.id]);

    const updatedCart = await fetchCartWithProducts(cart.id);

    return res.json({
      success: true,
      message: 'Cart item updated in database.',
      cartId: cart.id,
      sessionId: cart.effectiveSessionId || cart.session_id,
      items: updatedCart.items,
      cartCount: updatedCart.cartCount,
      cartSubtotal: updatedCart.cartSubtotal,
    });
  } catch (err) {
    console.error('Update Cart Item Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update item in database cart.' });
  }
};

/**
 * DELETE /api/user/cart/items/:productId
 * Removes an item from the cart in PostgreSQL
 */
export const removeCartItem = async (req, res) => {
  try {
    const { productId } = req.params;
    const cart = await getOrCreateCart(req);

    await db.query('DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cart.id, productId]);
    await db.query('UPDATE carts SET updated_at = NOW() WHERE id = $1', [cart.id]);

    const updatedCart = await fetchCartWithProducts(cart.id);

    return res.json({
      success: true,
      message: 'Item removed from database cart.',
      cartId: cart.id,
      sessionId: cart.effectiveSessionId || cart.session_id,
      items: updatedCart.items,
      cartCount: updatedCart.cartCount,
      cartSubtotal: updatedCart.cartSubtotal,
    });
  } catch (err) {
    console.error('Remove Cart Item Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to remove item from database cart.' });
  }
};

/**
 * DELETE /api/user/cart
 * Clears all items in the cart in PostgreSQL
 */
export const clearCart = async (req, res) => {
  try {
    const cart = await getOrCreateCart(req);

    await db.query('DELETE FROM cart_items WHERE cart_id = $1', [cart.id]);
    await db.query('UPDATE carts SET updated_at = NOW() WHERE id = $1', [cart.id]);

    return res.json({
      success: true,
      message: 'Database cart cleared successfully.',
      cartId: cart.id,
      sessionId: cart.effectiveSessionId || cart.session_id,
      items: [],
      cartCount: 0,
      cartSubtotal: 0,
    });
  } catch (err) {
    console.error('Clear Cart Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to clear database cart.' });
  }
};

import db from '../../config/db.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const VIDEO_EXT = /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i;

// Shared column list so every query returns the same shape
const BANNER_COLUMNS = `
  id,
  title,
  subtitle,
  cta_text AS "ctaText",
  cta_link AS "ctaLink",
  secondary_text AS "secondaryText",
  secondary_link AS "secondaryLink",
  media_type AS "mediaType",
  image_url AS "imageUrl",
  video_url AS "videoUrl",
  sort_order AS "sortOrder"
`;

const toStatusInt = (status) =>
  status === 1 ||
  status === '1' ||
  status === true ||
  String(status || 'Active').toLowerCase() === 'active'
    ? 1
    : 0;

/**
 * Decide the media type and validate the matching URL.
 * - Explicit mediaType wins ('image' | 'video').
 * - If mediaType is missing, we infer: videoUrl present (or imageUrl that
 *   looks like a video file) => video, otherwise image.
 *   This keeps older admin clients that only send imageUrl working.
 *
 * Returns { error } or { mediaType, imageUrl, videoUrl }.
 *   - image banner: imageUrl required, videoUrl = null
 *   - video banner: videoUrl required, imageUrl = optional poster ('' if none)
 */

// const isValidVideoUrl = (url) => {
//   try {
//     const pathname = new URL(url, 'http://localhost').pathname;
//     return /\.(mp4|webm|ogg|mov|m4v)$/i.test(pathname);
//   } catch {
//     return /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url);
//   }
// };
const resolveMedia = ({ mediaType, imageUrl, videoUrl }) => {
  const img = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  let vid = typeof videoUrl === 'string' ? videoUrl.trim() : '';

  let type;
  if (mediaType) {
    type = String(mediaType).toLowerCase() === 'video' ? 'video' : 'image';
  } else if (vid || VIDEO_EXT.test(img)) {
    type = 'video';
  } else {
    type = 'image';
  }
console.log('videoUrl received:', vid);
  if (type === 'video') {
    // Legacy client sent a video file inside imageUrl
    let poster = img;
    if (!vid && VIDEO_EXT.test(img)) {
      vid = img;
      poster = '';
    }
    if (!vid) return { error: 'Banner video URL is required.' };
//     if (!isValidVideoUrl(vid)) {
//   return {
//     error: 'Video must be an mp4, webm, ogg, mov or m4v file.',
//   };
// }
    return { mediaType: 'video', imageUrl: poster, videoUrl: vid };
  }

  if (!img) return { error: 'Banner image URL is required.' };
  return { mediaType: 'image', imageUrl: img, videoUrl: null };
};

/* ------------------------------------------------------------------ */
/* 1. Get All Banners (Admin)                                          */
/* ------------------------------------------------------------------ */
export const getBanners = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        ${BANNER_COLUMNS},
        status,
        starts_at AS "startsAt",
        ends_at AS "endsAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM banners
      WHERE status != 2
      ORDER BY sort_order ASC, id ASC
    `);

    const banners = rows.map((b) => ({
      ...b,
      status: b.status === 1 ? 'Active' : 'Inactive',
    }));

    return res.json({ success: true, count: banners.length, banners });
  } catch (err) {
    console.error('Get Banners Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch banners.' });
  }
};

/* ------------------------------------------------------------------ */
/* 2. Get Public Active Banners (Storefront)                           */
/* ------------------------------------------------------------------ */
export const getPublicBanners = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT ${BANNER_COLUMNS}
      FROM banners
      WHERE status = 1
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at >= NOW())
      ORDER BY sort_order ASC, id ASC
    `);

    return res.json({ success: true, count: rows.length, banners: rows });
  } catch (err) {
    console.error('Get Public Banners Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch active banners.' });
  }
};

/* ------------------------------------------------------------------ */
/* 3. Create Banner (Admin)                                            */
/* ------------------------------------------------------------------ */
export const createBanner = async (req, res) => {
  try {
    const {
      title,
      subtitle,
      ctaText,
      ctaLink,
      secondaryText,
      secondaryLink,
      mediaType,
      imageUrl,
      videoUrl,
      sortOrder,
      status,
      startsAt,
      endsAt,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Banner title is required.' });
    }

    const media = resolveMedia({ mediaType, imageUrl, videoUrl });
    if (media.error) {
      return res.status(400).json({ success: false, message: media.error });
    }

    const statusInt = toStatusInt(status);
    const orderInt = parseInt(sortOrder, 10) || 0;
    const finalStartsAt = startsAt ? new Date(startsAt) : (req.body.starts_at ? new Date(req.body.starts_at) : null);
    const finalEndsAt = endsAt ? new Date(endsAt) : (req.body.ends_at ? new Date(req.body.ends_at) : null);

    const { rows } = await db.query(
      `INSERT INTO banners
       (title, subtitle, cta_text, cta_link, secondary_text, secondary_link,
        media_type, image_url, video_url, sort_order, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       RETURNING ${BANNER_COLUMNS}, status, created_at AS "createdAt"`,
      [
        title.trim(),
        subtitle || '',
        ctaText || 'Explore Hardware',
        ctaLink || '/user/products',
        secondaryText || '',
        secondaryLink || '',
        media.mediaType,
        media.imageUrl,
        media.videoUrl,
        orderInt,
        statusInt,
        finalStartsAt,
        finalEndsAt,
      ]
    );

    const created = rows[0];
    created.status = created.status === 1 ? 'Active' : 'Inactive';

    return res.status(201).json({
      success: true,
      message: 'Banner created successfully.',
      banner: created,
    });
  } catch (err) {
    console.error('Create Banner Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create banner.' });
  }
};

/* ------------------------------------------------------------------ */
/* 4. Update Banner (Admin)                                            */
/* ------------------------------------------------------------------ */
export const updateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      subtitle,
      ctaText,
      ctaLink,
      secondaryText,
      secondaryLink,
      mediaType,
      imageUrl,
      videoUrl,
      sortOrder,
      status,
      startsAt,
      endsAt,
    } = req.body;

    const checkRes = await db.query('SELECT id FROM banners WHERE id = $1 AND status != 2', [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Banner not found.' });
    }

    const media = resolveMedia({ mediaType, imageUrl, videoUrl });
    if (media.error) {
      return res.status(400).json({ success: false, message: media.error });
    }

    const statusInt = toStatusInt(status);
    const orderInt = parseInt(sortOrder, 10) || 0;
    const finalStartsAt = startsAt ? new Date(startsAt) : (req.body.starts_at ? new Date(req.body.starts_at) : null);
    const finalEndsAt = endsAt ? new Date(endsAt) : (req.body.ends_at ? new Date(req.body.ends_at) : null);

    const { rows } = await db.query(
      `UPDATE banners
       SET title = $1,
           subtitle = $2,
           cta_text = $3,
           cta_link = $4,
           secondary_text = $5,
           secondary_link = $6,
           media_type = $7,
           image_url = $8,
           video_url = $9,
           sort_order = $10,
           status = $11,
           updated_at = NOW()
       WHERE id = $12
       RETURNING ${BANNER_COLUMNS}, status, updated_at AS "updatedAt"`,
      [
        title ? title.trim() : 'Banner',
        subtitle || '',
        ctaText || 'Explore Hardware',
        ctaLink || '/user/products',
        secondaryText || '',
        secondaryLink || '',
        media.mediaType,
        media.imageUrl,
        media.videoUrl,
        orderInt,
        statusInt,
        finalStartsAt,
        finalEndsAt,
        id,
      ]
    );

    const updated = rows[0];
    updated.status = updated.status === 1 ? 'Active' : 'Inactive';

    return res.json({
      success: true,
      message: 'Banner updated successfully.',
      banner: updated,
    });
  } catch (err) {
    console.error('Update Banner Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update banner.' });
  }
};

/* ------------------------------------------------------------------ */
/* 5. Delete Banner (Soft Delete, status = 2)                          */
/* ------------------------------------------------------------------ */
export const deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;

    const { rowCount } = await db.query(
      `UPDATE banners SET status = 2, updated_at = NOW() WHERE id = $1 AND status != 2`,
      [id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Banner not found or already deleted.' });
    }

    return res.json({
      success: true,
      message: 'Banner deleted successfully.',
      id: parseInt(id, 10),
    });
  } catch (err) {
    console.error('Delete Banner Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete banner.' });
  }
};
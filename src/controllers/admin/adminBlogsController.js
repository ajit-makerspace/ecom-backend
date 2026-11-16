import db from '../../config/db.js';


const formatBlog = (row) => ({
  id: String(row.id),
  mainHeading: row.main_heading,
  subHeading: row.sub_heading,
  lastUpdate: row.last_update,
  readingTime: row.reading_time,
  description: row.description,
  imageUrl: row.image_url,
  sections: row.sections || [],
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const validateBlog = (body, isUpdate = false) => {
  const errors = [];

 if (
  !isUpdate &&
  (typeof body.mainHeading !== 'string' || !body.mainHeading.trim())
) {
  errors.push('Blog main heading is required.');
} else if (
  body.mainHeading !== undefined &&
  (typeof body.mainHeading !== 'string' || !body.mainHeading.trim())
) {
  errors.push('Blog main heading is required.');
} else if (
  typeof body.mainHeading === 'string' &&
  body.mainHeading.trim().length > 255
) {
  errors.push('Main heading cannot exceed 255 characters.');
}

  if (
    body.subHeading !== undefined &&
    typeof body.subHeading !== 'string'
  ) {
    errors.push('Sub heading must be text.');
  }

  if (
    body.readingTime !== undefined &&
    (
      !Number.isInteger(Number(body.readingTime)) ||
      Number(body.readingTime) < 0
    )
  ) {
    errors.push('Reading time must be a non-negative integer.');
  }

  if (
    body.description !== undefined &&
    typeof body.description !== 'string'
  ) {
    errors.push('Description must be text.');
  }

  const imageValue = body.imageUrl ?? body.image;

  if (
    imageValue !== undefined &&
    imageValue !== null &&
    typeof imageValue !== 'string'
  ) {
    errors.push('Blog image must be text.');
  }

  if (
    body.lastUpdate !== undefined &&
    body.lastUpdate !== null &&
    body.lastUpdate !== '' &&
    (
      typeof body.lastUpdate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.lastUpdate) ||
      Number.isNaN(Date.parse(`${body.lastUpdate}T00:00:00.000Z`)) ||
      new Date(`${body.lastUpdate}T00:00:00.000Z`)
        .toISOString().slice(0, 10) !== body.lastUpdate
    )
  ) {
    errors.push('Last update must be a valid date in YYYY-MM-DD format.');
  }

  if (body.sections !== undefined) {
    if (!Array.isArray(body.sections)) {
      errors.push('Blog sections must be an array.');
    } else {
      body.sections.forEach((section, index) => {
        if (
          !section ||
          typeof section !== 'object' ||
          Array.isArray(section)
        ) {
          errors.push(`Section ${index + 1} must be an object.`);
          return;
        }

        if (
          typeof section.heading !== 'string' ||
          !section.heading.trim()
        ) {
          errors.push(`Section ${index + 1} heading is required.`);
        }

        if (typeof section.text !== 'string') {
          errors.push(`Section ${index + 1} text must be text.`);
        }
      });
    }
  }

  const activeValue =
    body.isActive !== undefined ? body.isActive : body.is_active;

  if (
    activeValue !== undefined &&
    ![true, false, 1, 0, 'true', 'false', '1', '0']
      .includes(activeValue)
  ) {
    errors.push('Active status must be true or false.');
  }

  return errors;
};



export const getBlogs = async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT
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
      FROM blogs
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


export const getBlogById = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Validate blog ID
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blog ID.',
      });
    }

    const result = await db.query(
      `
        SELECT
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
        FROM blogs
        WHERE id = $1
      `,
      [id]
    );

    // Check whether blog exists
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



export const createBlog = async (req, res, next) => {
  try {
    const body = req.body || {};

    // Validate request data
    const errors = validateBlog(body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: errors.join(' '),
      });
    }

    // Normalize active status
    const activeInput =
      body.isActive !== undefined ? body.isActive : body.is_active;

    const isActive =
      activeInput === undefined
        ? true
        : [true, 1, 'true', '1'].includes(activeInput);

    // Prepare blog image
    const imageValue =
      body.imageUrl !== undefined ? body.imageUrl : body.image;

    // Prepare database values
    const values = [
      body.mainHeading.trim(),
      body.subHeading?.trim() || '',
      body.lastUpdate || null,
      body.readingTime !== undefined
        ? Number(body.readingTime)
        : 0,
      body.description?.trim() || '',
      imageValue?.trim() || '',
      JSON.stringify(body.sections || []),
      isActive,
    ];

    // Insert blog into database
    const result = await db.query(
      `
        INSERT INTO blogs (
          main_heading,
          sub_heading,
          last_update,
          reading_time,
          description,
          image_url,
          sections,
          is_active
        )
        VALUES (
          $1, $2, COALESCE($3::date, CURRENT_DATE),
          $4, $5, $6, $7::jsonb, $8
        )
        RETURNING
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
      `,
      values
    );

    return res.status(201).json({
      success: true,
      message: 'Blog created successfully.',
      data: formatBlog(result.rows[0]),
    });

  } catch (error) {
    next(error);
  }
};



export const updateBlog = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Validate blog ID
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blog ID.',
      });
    }

    const body = req.body || {};

    // Validate incoming data
    // const errors = validateBlog(body);

    const errors = validateBlog(body, true);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: errors.join(' '),
      });
    }

    // Fetch existing blog
    const existingResult = await db.query(
      `
        SELECT *
        FROM blogs
        WHERE id = $1
      `,
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blog not found.',
      });
    }

    const existing = existingResult.rows[0];

    // Preserve existing values when fields are omitted
    const mainHeading =
      body.mainHeading !== undefined
        ? body.mainHeading.trim()
        : existing.main_heading;

    const subHeading =
      body.subHeading !== undefined
        ? body.subHeading.trim()
        : existing.sub_heading;

    const lastUpdate =
      body.lastUpdate !== undefined
        ? body.lastUpdate || null
        : existing.last_update;

    const readingTime =
      body.readingTime !== undefined
        ? Number(body.readingTime)
        : existing.reading_time;

    const description =
      body.description !== undefined
        ? body.description.trim()
        : existing.description;

    const imageInput =
      body.imageUrl !== undefined
        ? body.imageUrl
        : body.image !== undefined
          ? body.image
          : existing.image_url;

    // const imageUrl = imageInput.trim();
    const imageUrl =
  typeof imageInput === 'string' ? imageInput.trim() : '';

    const sections =
      body.sections !== undefined
        ? body.sections
        : existing.sections;

    const activeInput =
      body.isActive !== undefined
        ? body.isActive
        : body.is_active !== undefined
          ? body.is_active
          : existing.is_active;

    const isActive =
      [true, 1, 'true', '1'].includes(activeInput);

    // Update blog
    const result = await db.query(
      `
        UPDATE blogs
        SET
          main_heading = $2,
          sub_heading = $3,
          last_update = $4,
          reading_time = $5,
          description = $6,
          image_url = $7,
          sections = $8::jsonb,
          is_active = $9,
          updated_at = NOW()
        WHERE id = $1
        RETURNING
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
      `,
      [
        id,
        mainHeading,
        subHeading,
        lastUpdate,
        readingTime,
        description,
        imageUrl,
        JSON.stringify(sections),
        isActive,
      ]
    );

    return res.status(200).json({
      success: true,
      message: 'Blog updated successfully.',
      data: formatBlog(result.rows[0]),
    });

  } catch (error) {
    next(error);
  }
};

export const deleteBlog = async (req, res, next) => {
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
        DELETE FROM blogs
        WHERE id = $1
        RETURNING id, main_heading
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
      message: 'Blog deleted successfully.',
      data: {
        id: String(result.rows[0].id),
        mainHeading: result.rows[0].main_heading,
      },
    });
  } catch (error) {
    next(error);
  }
};
import db from '../../config/db.js';

// Get Authenticated Customer Profile
export const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await db.query(
      `SELECT id, email, first_name, last_name, phone, date_of_birth, gender, profile_image_url, role, status, created_at, last_login_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = rows[0];

    const addrRes = await db.query(
      `SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );

    const gstRes = await db.query(
      `SELECT * FROM user_gst_numbers WHERE user_id = $1 AND status = 1 ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );
    const gstNumbers = gstRes.rows;
    const defaultGst = gstNumbers.find((g) => g.is_default) || gstNumbers[0] || null;

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        dateOfBirth: user.date_of_birth,
        gender: user.gender,
        profileImageUrl: user.profile_image_url,
        role: 'Customer',
        status: user.status === 1 ? 'Active' : 'Inactive',
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
        addresses: addrRes.rows,
        gstin: defaultGst?.gstin || '',
        legalBusinessName: defaultGst?.legal_business_name || '',
        tradeName: defaultGst?.trade_name || '',
        gstProfile: defaultGst,
        gstNumbers: gstNumbers,
      },
    });
  } catch (err) {
    console.error('Get Profile Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch user profile.' });
  }
};

// Update Authenticated Customer Profile Details
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { first_name, last_name, phone, date_of_birth, gender, profile_image_url, gstin, legal_business_name, trade_name } = req.body;

    const cleanFirstName = first_name !== undefined ? String(first_name).trim() : null;
    const cleanLastName = last_name !== undefined ? String(last_name).trim() : null;
    const cleanPhone = phone !== undefined ? String(phone).trim() : null;
    const cleanDob = date_of_birth || null;
    const cleanGender = gender !== undefined ? String(gender).trim() : null;
    const cleanImage = profile_image_url !== undefined ? profile_image_url : null;

    const { rows } = await db.query(
      `UPDATE users
       SET 
         first_name = COALESCE($2, first_name),
         last_name = COALESCE($3, last_name),
         phone = COALESCE($4, phone),
         date_of_birth = COALESCE($5, date_of_birth),
         gender = COALESCE($6, gender),
         profile_image_url = COALESCE($7, profile_image_url),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, first_name, last_name, phone, date_of_birth, gender, profile_image_url, role, status, created_at, updated_at`,
      [userId, cleanFirstName, cleanLastName, cleanPhone, cleanDob, cleanGender, cleanImage]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const u = rows[0];

    // Upsert customer GST profile if GSTIN is provided
    let savedGstin = '';
    let savedBusinessName = '';
    let savedTradeName = '';

    if (gstin !== undefined) {
      const cleanGstin = String(gstin).trim().toUpperCase();
      const cleanBusinessName = legal_business_name ? String(legal_business_name).trim() : `${u.first_name || 'Customer'} Business`;
      const cleanTradeName = trade_name ? String(trade_name).trim() : null;

      if (cleanGstin) {
        const countRes = await db.query(
          `SELECT COUNT(*) FROM user_gst_numbers WHERE user_id = $1 AND status = 1`,
          [userId]
        );
        const shouldBeDefault = parseInt(countRes.rows[0].count, 10) === 0;

        const gstUpsertRes = await db.query(
          `INSERT INTO user_gst_numbers (
            user_id,
            gstin,
            legal_business_name,
            trade_name,
            is_default,
            status,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, 1, NOW(), NOW())
          ON CONFLICT (user_id, gstin)
          DO UPDATE SET
            legal_business_name = EXCLUDED.legal_business_name,
            trade_name = COALESCE(EXCLUDED.trade_name, user_gst_numbers.trade_name),
            status = 1,
            updated_at = NOW()
          RETURNING *`,
          [userId, cleanGstin, cleanBusinessName, cleanTradeName, shouldBeDefault]
        );
        if (gstUpsertRes.rows[0]) {
          savedGstin = gstUpsertRes.rows[0].gstin;
          savedBusinessName = gstUpsertRes.rows[0].legal_business_name;
          savedTradeName = gstUpsertRes.rows[0].trade_name;
        }
      }
    } else {
      const existingGst = await db.query(
        `SELECT * FROM user_gst_numbers WHERE user_id = $1 AND status = 1 ORDER BY is_default DESC, updated_at DESC LIMIT 1`,
        [userId]
      );
      if (existingGst.rows[0]) {
        savedGstin = existingGst.rows[0].gstin;
        savedBusinessName = existingGst.rows[0].legal_business_name;
        savedTradeName = existingGst.rows[0].trade_name;
      }
    }

    return res.json({
      success: true,
      message: 'Profile updated successfully.',
      user: {
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        phone: u.phone,
        dateOfBirth: u.date_of_birth,
        gender: u.gender,
        profileImageUrl: u.profile_image_url,
        role: 'Customer',
        status: u.status === 1 ? 'Active' : 'Inactive',
        gstin: savedGstin,
        legalBusinessName: savedBusinessName,
        tradeName: savedTradeName,
      },
    });
  } catch (err) {
    console.error('Update Profile Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
};

// Customer Address Management
export const getAddresses = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await db.query(
      `SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );

    return res.json({ success: true, count: rows.length, addresses: rows });
  } catch (err) {
    console.error('Get Addresses Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch addresses.' });
  }
};

export const createAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      address_type = 'shipping',
      first_name,
      last_name,
      phone,
      address_line_1,
      address_line_2,
      city,
      state,
      postal_code,
      country = 'India',
      is_default = false,
    } = req.body;

    if (!first_name || !address_line_1 || !city || !state || !postal_code) {
      return res.status(400).json({ success: false, message: 'Required address fields are missing.' });
    }

    if (is_default) {
      await db.query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [userId]);
    }

    const { rows } = await db.query(
      `INSERT INTO user_addresses (
        user_id, address_type, first_name, last_name, phone,
        address_line_1, address_line_2, city, state, postal_code, country, is_default, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      RETURNING *`,
      [
        userId,
        address_type,
        String(first_name).trim(),
        last_name ? String(last_name).trim() : '',
        phone ? String(phone).trim() : '',
        String(address_line_1).trim(),
        address_line_2 ? String(address_line_2).trim() : '',
        String(city).trim(),
        String(state).trim(),
        String(postal_code).trim(),
        country || 'India',
        Boolean(is_default),
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Address added successfully.',
      address: rows[0],
    });
  } catch (err) {
    console.error('Create Address Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create address.' });
  }
};

export const deleteAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { rows } = await db.query(
      'DELETE FROM user_addresses WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Address not found or unauthorized.' });
    }

    return res.json({ success: true, message: 'Address removed successfully.' });
  } catch (err) {
    console.error('Delete Address Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete address.' });
  }
};

export const updateAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      address_type = 'shipping',
      first_name,
      last_name,
      phone,
      address_line_1,
      address_line_2,
      city,
      state,
      postal_code,
      country = 'India',
      is_default = false,
    } = req.body;

    if (is_default) {
      await db.query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [userId]);
    }

    const { rows } = await db.query(
      `UPDATE user_addresses
       SET 
         address_type = $1,
         first_name = $2,
         last_name = $3,
         phone = $4,
         address_line_1 = $5,
         address_line_2 = $6,
         city = $7,
         state = $8,
         postal_code = $9,
         country = $10,
         is_default = $11,
         updated_at = NOW()
       WHERE id = $12 AND user_id = $13
       RETURNING *`,
      [
        address_type,
        String(first_name).trim(),
        last_name ? String(last_name).trim() : '',
        phone ? String(phone).trim() : '',
        String(address_line_1).trim(),
        address_line_2 ? String(address_line_2).trim() : '',
        String(city).trim(),
        String(state).trim(),
        String(postal_code).trim(),
        country || 'India',
        Boolean(is_default),
        id,
        userId,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Address not found or unauthorized.' });
    }

    return res.json({
      success: true,
      message: 'Address updated successfully.',
      address: rows[0],
    });
  } catch (err) {
    console.error('Update Address Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update address.' });
  }
};

// Get All Customer GST Numbers (supports multiple GST numbers)
export const getUserGstNumbers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await db.query(
      `SELECT ugn.*, 
              ua.first_name AS addr_first_name, ua.last_name AS addr_last_name,
              ua.address_line_1, ua.address_line_2, ua.city, ua.state, ua.postal_code, ua.country
       FROM user_gst_numbers ugn
       LEFT JOIN user_addresses ua ON ugn.billing_address_id = ua.id
       WHERE ugn.user_id = $1 AND ugn.status = 1
       ORDER BY ugn.is_default DESC, ugn.created_at DESC`,
      [userId]
    );

    return res.json({
      success: true,
      gstNumbers: rows,
    });
  } catch (err) {
    console.error('Get GST Numbers Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch GST numbers.' });
  }
};

// Create a New Customer GST Number
export const createUserGstNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const { gstin, legal_business_name, trade_name, billing_address_id, is_default } = req.body;

    if (!gstin || !legal_business_name) {
      return res.status(400).json({
        success: false,
        message: 'GSTIN and Legal Business Name are required.',
      });
    }

    const cleanGstin = String(gstin).trim().toUpperCase();
    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
    if (!gstRegex.test(cleanGstin)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid GSTIN format. Expected 15-character format (e.g. 29ABCDE1234F1Z5).',
      });
    }

    const cleanBusinessName = String(legal_business_name).trim();
    const cleanTradeName = trade_name ? String(trade_name).trim() : null;

    // Check existing active count
    const countRes = await db.query(
      `SELECT COUNT(*) FROM user_gst_numbers WHERE user_id = $1 AND status = 1`,
      [userId]
    );
    const isFirst = parseInt(countRes.rows[0].count, 10) === 0;
    const shouldBeDefault = Boolean(is_default) || isFirst;

    if (shouldBeDefault) {
      await db.query(`UPDATE user_gst_numbers SET is_default = FALSE WHERE user_id = $1`, [userId]);
    }

    const { rows } = await db.query(
      `INSERT INTO user_gst_numbers (
        user_id,
        gstin,
        legal_business_name,
        trade_name,
        billing_address_id,
        is_default,
        status,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, NOW(), NOW())
      ON CONFLICT (user_id, gstin)
      DO UPDATE SET
        legal_business_name = EXCLUDED.legal_business_name,
        trade_name = COALESCE(EXCLUDED.trade_name, user_gst_numbers.trade_name),
        billing_address_id = COALESCE(EXCLUDED.billing_address_id, user_gst_numbers.billing_address_id),
        is_default = CASE WHEN $6 = TRUE THEN TRUE ELSE user_gst_numbers.is_default END,
        status = 1,
        updated_at = NOW()
      RETURNING *`,
      [userId, cleanGstin, cleanBusinessName, cleanTradeName, billing_address_id || null, shouldBeDefault]
    );

    return res.json({
      success: true,
      message: 'GST number saved successfully.',
      gstNumber: rows[0],
    });
  } catch (err) {
    console.error('Create GST Number Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to save GST number.' });
  }
};

// Update an Existing Customer GST Number
export const updateUserGstNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { legal_business_name, trade_name, billing_address_id, is_default } = req.body;

    if (is_default) {
      await db.query(`UPDATE user_gst_numbers SET is_default = FALSE WHERE user_id = $1`, [userId]);
    }

    const { rows } = await db.query(
      `UPDATE user_gst_numbers
       SET legal_business_name = COALESCE($1, legal_business_name),
           trade_name = COALESCE($2, trade_name),
           billing_address_id = COALESCE($3, billing_address_id),
           is_default = COALESCE($4, is_default),
           updated_at = NOW()
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [
        legal_business_name ? String(legal_business_name).trim() : null,
        trade_name !== undefined ? (trade_name ? String(trade_name).trim() : null) : null,
        billing_address_id !== undefined ? billing_address_id : null,
        is_default !== undefined ? Boolean(is_default) : null,
        id,
        userId,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'GST number not found.' });
    }

    return res.json({
      success: true,
      message: 'GST number updated successfully.',
      gstNumber: rows[0],
    });
  } catch (err) {
    console.error('Update GST Number Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update GST number.' });
  }
};

// Delete a Customer GST Number
export const deleteUserGstNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const checkRes = await db.query(
      `SELECT * FROM user_gst_numbers WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'GST number not found.' });
    }

    const wasDefault = checkRes.rows[0].is_default;

    await db.query(
      `DELETE FROM user_gst_numbers WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    // If the deleted record was the default, pick the most recently updated active one
    if (wasDefault) {
      await db.query(
        `UPDATE user_gst_numbers
         SET is_default = TRUE
         WHERE id = (
           SELECT id FROM user_gst_numbers
           WHERE user_id = $1 AND status = 1
           ORDER BY updated_at DESC LIMIT 1
         )`,
        [userId]
      );
    }

    return res.json({
      success: true,
      message: 'GST number deleted successfully.',
    });
  } catch (err) {
    console.error('Delete GST Number Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete GST number.' });
  }
};

// Set a Customer GST Number as Default
export const setDefaultGstNumber = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    await db.query(`UPDATE user_gst_numbers SET is_default = FALSE WHERE user_id = $1`, [userId]);
    const { rows } = await db.query(
      `UPDATE user_gst_numbers SET is_default = TRUE, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'GST number not found.' });
    }

    return res.json({
      success: true,
      message: 'Default GST number updated.',
      gstNumber: rows[0],
    });
  } catch (err) {
    console.error('Set Default GST Number Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to set default GST number.' });
  }
};

// Backwards-compatible: Get primary/default GST Profile
export const getGstProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await db.query(
      `SELECT * FROM user_gst_numbers 
       WHERE user_id = $1 AND status = 1
       ORDER BY is_default DESC, updated_at DESC LIMIT 1`,
      [userId]
    );

    return res.json({
      success: true,
      gstProfile: rows[0] || null,
    });
  } catch (err) {
    console.error('Get GST Profile Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch GST profile.' });
  }
};

// Backwards-compatible: Save / Upsert GST Profile
export const saveGstProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { gstin, legal_business_name, trade_name, billing_address_id } = req.body;

    if (!gstin || !legal_business_name) {
      return res.status(400).json({
        success: false,
        message: 'GSTIN and Legal Business Name are required.',
      });
    }

    const cleanGstin = String(gstin).trim().toUpperCase();
    const cleanBusinessName = String(legal_business_name).trim();
    const cleanTradeName = trade_name ? String(trade_name).trim() : null;

    const countRes = await db.query(
      `SELECT COUNT(*) FROM user_gst_numbers WHERE user_id = $1 AND status = 1`,
      [userId]
    );
    const shouldBeDefault = parseInt(countRes.rows[0].count, 10) === 0;

    const { rows } = await db.query(
      `INSERT INTO user_gst_numbers (
        user_id,
        billing_address_id,
        gstin,
        legal_business_name,
        trade_name,
        is_default,
        status,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, NOW(), NOW())
      ON CONFLICT (user_id, gstin)
      DO UPDATE SET
        legal_business_name = EXCLUDED.legal_business_name,
        trade_name = COALESCE(EXCLUDED.trade_name, user_gst_numbers.trade_name),
        billing_address_id = COALESCE(EXCLUDED.billing_address_id, user_gst_numbers.billing_address_id),
        status = 1,
        updated_at = NOW()
      RETURNING *`,
      [userId, billing_address_id || null, cleanGstin, cleanBusinessName, cleanTradeName, shouldBeDefault]
    );

    return res.json({
      success: true,
      message: 'GST Profile saved successfully.',
      gstProfile: rows[0],
    });
  } catch (err) {
    console.error('Save GST Profile Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to save GST profile.' });
  }
};


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
    const { first_name, last_name, phone, date_of_birth, gender, profile_image_url } = req.body;

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


import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../../config/db.js';

// Customer Registration Controller (Inserts into public.users and optionally public.user_addresses)
export const registerUser = async (req, res) => {
  try {
    const {
      email,
      password,
      first_name,
      last_name,
      phone,
      date_of_birth,
      gender,
      profile_image_url,
      // Optional Address fields
      address_line_1,
      address_line_2,
      city,
      state,
      postal_code,
      country = 'India',
    } = req.body;

    if (!email || !password || !first_name) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and first name are required.',
      });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanPassword = String(password).trim();
    const cleanFirstName = String(first_name).trim();
    const cleanLastName = last_name ? String(last_name).trim() : null;
    const cleanPhone = phone ? String(phone).trim() : null;
    const cleanDob = date_of_birth ? String(date_of_birth).trim() : null;
    const cleanGender = gender ? String(gender).trim() : null;

    // Check if user email already exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE LOWER(email) = $1',
      [cleanEmail]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.',
      });
    }

    // Hash Password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(cleanPassword, saltRounds);

    // Insert into users table (storing both hashed password_hash and plain password)
    const insertUserQuery = `
      INSERT INTO users (
        email,
        password_hash,
        password,
        role,
        status,
        first_name,
        last_name,
        phone,
        date_of_birth,
        gender,
        profile_image_url,
        last_login_at,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), NOW())
      RETURNING id, email, first_name, last_name, phone, gender, date_of_birth, role, status, created_at;
    `;

    const userValues = [
      cleanEmail,
      passwordHash,
      cleanPassword, // Plain password stored in public.users(password)
      1, // Role: 1 = Customer
      1, // Status: 1 = Active
      cleanFirstName,
      cleanLastName,
      cleanPhone,
      cleanDob,
      cleanGender,
      profile_image_url || null,
    ];

    const newUserRes = await db.query(insertUserQuery, userValues);
    const user = newUserRes.rows[0];

    // Optionally insert default user address if address_line_1 provided
    let createdAddress = null;
    if (address_line_1 && city && state && postal_code) {
      const insertAddressQuery = `
        INSERT INTO user_addresses (
          user_id,
          address_type,
          first_name,
          last_name,
          phone,
          address_line_1,
          address_line_2,
          city,
          state,
          postal_code,
          country,
          is_default,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
        RETURNING id, address_type, address_line_1, city, state, postal_code, country;
      `;

      const addressValues = [
        user.id,
        'shipping',
        cleanFirstName,
        cleanLastName,
        cleanPhone,
        String(address_line_1).trim(),
        address_line_2 ? String(address_line_2).trim() : null,
        String(city).trim(),
        String(state).trim(),
        String(postal_code).trim(),
        country ? String(country).trim() : 'India',
        true, // is_default
      ];

      const newAddressRes = await db.query(insertAddressQuery, addressValues);
      createdAddress = newAddressRes.rows[0];
    }

    // Issue JWT Token for the registered Customer
    const payload = {
      id: user.id,
      email: user.email,
      role: 'CUSTOMER',
      user_type: 1,
    };

    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET || 'supersecretkey123_aura_admin',
      { expiresIn: '30d' }
    );

    return res.status(201).json({
      success: true,
      message: 'Registration successful! Welcome to MakerSpace Shop.',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        gender: user.gender,
        dateOfBirth: user.date_of_birth,
        role: 'Customer',
        address: createdAddress,
      },
    });
  } catch (err) {
    console.error('User Registration Controller Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Server error during registration.',
    });
  }
};

// Customer Login Controller
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanPassword = String(password).trim();

    const { rows } = await db.query(
      'SELECT id, email, password_hash, password, first_name, last_name, phone, status FROM users WHERE LOWER(email) = $1',
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const user = rows[0];

    if (user.status !== 1) {
      return res.status(403).json({ success: false, message: 'Account is deactivated.' });
    }

    const isBcryptValid = user.password_hash ? await bcrypt.compare(cleanPassword, user.password_hash) : false;
    const isPlainValid = user.password ? cleanPassword === user.password : false;

    if (!isBcryptValid && !isPlainValid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const payload = {
      id: user.id,
      email: user.email,
      role: 'CUSTOMER',
      user_type: 1,
    };

    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET || 'supersecretkey123_aura_admin',
      { expiresIn: '30d' }
    );

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        role: 'Customer',
      },
    });
  } catch (err) {
    console.error('User Login Controller Error:', err);
    return res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

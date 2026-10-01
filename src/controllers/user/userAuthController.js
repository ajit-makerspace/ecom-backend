import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../../config/db.js';
import { JWT_SECRET } from '../../config/jwt.js';
import emailService from '../../services/emailService.js';

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

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.',
      });
    }

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

    // Secure bcrypt hashing (NO plaintext passwords stored!)
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(cleanPassword, saltRounds);

    const insertUserQuery = `
      INSERT INTO users (
        email,
        password_hash,
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
      ) VALUES ($1, $2, 1, 1, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NOW())
      RETURNING id, email, first_name, last_name, phone, gender, date_of_birth, role, status, created_at;
    `;

    const userValues = [
      cleanEmail,
      passwordHash,
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
        ) VALUES ($1, 'shipping', $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW(), NOW())
        RETURNING id, address_type, address_line_1, city, state, postal_code, country;
      `;

      const addressValues = [
        user.id,
        cleanFirstName,
        cleanLastName,
        cleanPhone,
        String(address_line_1).trim(),
        address_line_2 ? String(address_line_2).trim() : null,
        String(city).trim(),
        String(state).trim(),
        String(postal_code).trim(),
        country ? String(country).trim() : 'India',
      ];

      const newAddressRes = await db.query(insertAddressQuery, addressValues);
      createdAddress = newAddressRes.rows[0];
    }

    // Issue JWT Token for the registered Customer
    const payload = {
      id: user.id,
      email: user.email,
      role: 'CUSTOMER',
      user_type: 2,
    };

    const token = jwt.sign(
      payload,
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Send welcome email in background (non-blocking)
    emailService.sendWelcomeEmail({ email: cleanEmail, firstName: cleanFirstName }).catch(err => {
      console.warn('Notice: Background welcome email:', err.message);
    });

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
      `SELECT id, email, password_hash, first_name, last_name, phone, gender, date_of_birth, status, profile_image_url
       FROM users
       WHERE LOWER(email) = $1`,
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const user = rows[0];

    if (user.status !== 1) {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated. Please contact support.' });
    }

    // Verify bcrypt hash securely
    const isPasswordValid = await bcrypt.compare(cleanPassword, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Update last_login_at
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    // Fetch user default address if exists
    const addrRes = await db.query(
      'SELECT id, address_line_1, city, state, postal_code, country FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC LIMIT 1',
      [user.id]
    );

    const payload = {
      id: user.id,
      email: user.email,
      role: 'CUSTOMER',
      user_type: 2,
    };

    const token = jwt.sign(
      payload,
      JWT_SECRET,
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
        gender: user.gender,
        dateOfBirth: user.date_of_birth,
        profileImageUrl: user.profile_image_url,
        role: 'Customer',
        address: addrRes.rows[0] || null,
      },
    });
  } catch (err) {
    console.error('User Login Controller Error:', err);
    return res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

// Customer Get Profile / Session Controller
export const getCustomerMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await db.query(
      `SELECT id, email, first_name, last_name, phone, gender, date_of_birth, status, profile_image_url, created_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }

    const u = rows[0];
    const addrRes = await db.query(
      'SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
      [userId]
    );

    return res.json({
      success: true,
      user: {
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        phone: u.phone,
        gender: u.gender,
        dateOfBirth: u.date_of_birth,
        profileImageUrl: u.profile_image_url,
        role: 'Customer',
        status: u.status === 1 ? 'Active' : 'Inactive',
        createdAt: u.created_at,
        addresses: addrRes.rows,
      },
    });
  } catch (err) {
    console.error('Customer Me Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch customer profile.' });
  }
};

// Send Login OTP Controller
export const sendLoginOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    // Check if user exists to retrieve first name
    const { rows: userRows } = await db.query(
      'SELECT first_name FROM users WHERE LOWER(email) = $1',
      [cleanEmail]
    );

    const firstName = userRows.length > 0 && userRows[0].first_name ? userRows[0].first_name : 'Maker';

    // Invalidate previous active login OTPs for this email
    await db.query(
      `UPDATE email_otps SET is_used = true WHERE LOWER(email) = $1 AND purpose = 'login' AND is_used = false`,
      [cleanEmail]
    );

    // Generate secure 6-digit OTP code
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Insert new OTP with 10-minute expiry
    await db.query(
      `INSERT INTO email_otps (email, otp_code, purpose, expires_at)
       VALUES ($1, $2, 'login', NOW() + INTERVAL '10 minutes')`,
      [cleanEmail, otpCode]
    );

    // Send email using SMTP
    try {
      await emailService.sendLoginOtpEmail({
        email: cleanEmail,
        otp: otpCode,
        firstName,
      });
    } catch (smtpError) {
      console.error('SMTP Delivery Error in sendLoginOtp:', smtpError);
      return res.status(500).json({
        success: false,
        message: 'Could not deliver verification email. Please check your email address and try again.',
      });
    }

    return res.json({
      success: true,
      message: `A 6-digit login verification code has been sent to ${cleanEmail}.`,
    });
  } catch (err) {
    console.error('Send Login OTP Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error generating login code.' });
  }
};

// Verify Login OTP Controller
export const verifyLoginOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and verification code are required.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanOtp = String(otp).trim();

    // Verify OTP from database
    const { rows: otpRows } = await db.query(
      `SELECT id, expires_at, is_used
       FROM email_otps
       WHERE LOWER(email) = $1 AND otp_code = $2 AND purpose = 'login' AND is_used = false AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [cleanEmail, cleanOtp]
    );

    if (otpRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code. Please request a new code.',
      });
    }

    // Mark OTP as used
    await db.query('UPDATE email_otps SET is_used = true WHERE id = $1', [otpRows[0].id]);

    // Check if user already exists
    const { rows: userRows } = await db.query(
      `SELECT id, email, first_name, last_name, phone, gender, date_of_birth, status, profile_image_url
       FROM users
       WHERE LOWER(email) = $1`,
      [cleanEmail]
    );

    let user;

    if (userRows.length > 0) {
      user = userRows[0];
      if (user.status !== 1) {
        return res.status(403).json({ success: false, message: 'Your account has been deactivated. Please contact support.' });
      }
      // Update last login
      await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    } else {
      // Auto-create customer account on first successful OTP login
      const autoFirstName = cleanEmail.split('@')[0];
      const saltRounds = 10;
      const placeholderHash = await bcrypt.hash(Math.random().toString(36) + Date.now().toString(), saltRounds);

      const { rows: newRows } = await db.query(
        `INSERT INTO users (
          email, password_hash, role, status, first_name, last_login_at, created_at, updated_at
        ) VALUES ($1, $2, 1, 1, $3, NOW(), NOW(), NOW())
        RETURNING id, email, first_name, last_name, phone, gender, date_of_birth, status, profile_image_url`,
        [cleanEmail, placeholderHash, autoFirstName]
      );
      user = newRows[0];

      // Send welcome email in background
      emailService.sendWelcomeEmail({ email: cleanEmail, firstName: autoFirstName }).catch(e => {
        console.warn('Notice: Background welcome email:', e.message);
      });
    }

    // Fetch user default address if exists
    const addrRes = await db.query(
      'SELECT id, address_line_1, city, state, postal_code, country FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC LIMIT 1',
      [user.id]
    );

    // Issue JWT Token
    const payload = {
      id: user.id,
      email: user.email,
      role: 'CUSTOMER',
      user_type: 2,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });

    return res.json({
      success: true,
      message: 'Login successful!',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        gender: user.gender,
        dateOfBirth: user.date_of_birth,
        profileImageUrl: user.profile_image_url,
        role: 'Customer',
        address: addrRes.rows[0] || null,
      },
    });
  } catch (err) {
    console.error('Verify Login OTP Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error verifying login code.' });
  }
};

// Send Password Reset OTP
export const sendPasswordResetOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();

    const { rows: userRows } = await db.query(
      'SELECT id, first_name FROM users WHERE LOWER(email) = $1',
      [cleanEmail]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: 'No account found with this email address.' });
    }

    const firstName = userRows[0].first_name || 'Maker';

    await db.query(
      `UPDATE email_otps SET is_used = true WHERE LOWER(email) = $1 AND purpose = 'reset_password' AND is_used = false`,
      [cleanEmail]
    );

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    await db.query(
      `INSERT INTO email_otps (email, otp_code, purpose, expires_at)
       VALUES ($1, $2, 'reset_password', NOW() + INTERVAL '10 minutes')`,
      [cleanEmail, otpCode]
    );

    await emailService.sendLoginOtpEmail({
      email: cleanEmail,
      otp: otpCode,
      firstName,
    });

    return res.json({
      success: true,
      message: `Password reset code sent to ${cleanEmail}.`,
    });
  } catch (err) {
    console.error('Send Password Reset OTP Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Error generating reset code.' });
  }
};

// Reset Password with OTP
export const resetPasswordWithOtp = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'Email, reset code, and new password are required.' });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanOtp = String(otp).trim();

    const { rows: otpRows } = await db.query(
      `SELECT id FROM email_otps
       WHERE LOWER(email) = $1 AND otp_code = $2 AND purpose = 'reset_password' AND is_used = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [cleanEmail, cleanOtp]
    );

    if (otpRows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired password reset code.' });
    }

    await db.query('UPDATE email_otps SET is_used = true WHERE id = $1', [otpRows[0].id]);

    const passwordHash = await bcrypt.hash(String(newPassword).trim(), 10);
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE LOWER(email) = $2',
      [passwordHash, cleanEmail]
    );

    return res.json({
      success: true,
      message: 'Password has been reset successfully. You can now log in with your new password.',
    });
  } catch (err) {
    console.error('Reset Password Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Error resetting password.' });
  }
};


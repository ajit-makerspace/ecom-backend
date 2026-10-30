import crypto from 'crypto';
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
      message: 'Registration successful! Welcome to Makerspace Shop.',
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

    // Generate cryptographically secure 6-digit OTP code (SEC-06)
    const otpCode = crypto.randomInt(100000, 1000000).toString();

    // Insert new OTP with 10-minute expiry and zero attempts
    await db.query(
      `INSERT INTO email_otps (email, otp_code, purpose, attempts, expires_at)
       VALUES ($1, $2, 'login', 0, NOW() + INTERVAL '10 minutes')`,
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

    // Fetch active OTP for rate-limiting & brute force checks (SEC-06)
    const { rows: otpRows } = await db.query(
      `SELECT id, otp_code, attempts, expires_at
       FROM email_otps
       WHERE LOWER(email) = $1 AND purpose = 'login' AND is_used = false AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [cleanEmail]
    );

    if (otpRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code. Please request a new code.',
      });
    }

    const activeOtp = otpRows[0];

    // Enforce 5-attempt limit
    if (activeOtp.attempts >= 5) {
      await db.query('UPDATE email_otps SET is_used = true WHERE id = $1', [activeOtp.id]);
      return res.status(429).json({
        success: false,
        message: 'Too many failed verification attempts. Please request a new code.',
      });
    }

    if (activeOtp.otp_code !== cleanOtp) {
      const nextAttempts = activeOtp.attempts + 1;
      const isExhausted = nextAttempts >= 5;
      await db.query(
        'UPDATE email_otps SET attempts = $1, is_used = $2 WHERE id = $3',
        [nextAttempts, isExhausted, activeOtp.id]
      );

      if (isExhausted) {
        return res.status(429).json({
          success: false,
          message: 'Too many failed verification attempts. This code has been deactivated. Please request a new code.',
        });
      }

      return res.status(400).json({
        success: false,
        message: `Invalid verification code. ${5 - nextAttempts} attempts remaining.`,
      });
    }

    // Mark OTP as used
    await db.query('UPDATE email_otps SET is_used = true WHERE id = $1', [activeOtp.id]);

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
      const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), saltRounds);

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

    // Generate cryptographically secure 6-digit OTP code (SEC-06)
    const otpCode = crypto.randomInt(100000, 1000000).toString();

    await db.query(
      `INSERT INTO email_otps (email, otp_code, purpose, attempts, expires_at)
       VALUES ($1, $2, 'reset_password', 0, NOW() + INTERVAL '10 minutes')`,
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

    // Fetch active password reset OTP for brute-force verification (SEC-06)
    const { rows: otpRows } = await db.query(
      `SELECT id, otp_code, attempts, expires_at
       FROM email_otps
       WHERE LOWER(email) = $1 AND purpose = 'reset_password' AND is_used = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [cleanEmail]
    );

    if (otpRows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired password reset code. Please request a new code.' });
    }

    const activeOtp = otpRows[0];

    // Enforce 5-attempt limit
    if (activeOtp.attempts >= 5) {
      await db.query('UPDATE email_otps SET is_used = true WHERE id = $1', [activeOtp.id]);
      return res.status(429).json({
        success: false,
        message: 'Too many failed verification attempts. Please request a new reset code.',
      });
    }

    if (activeOtp.otp_code !== cleanOtp) {
      const nextAttempts = activeOtp.attempts + 1;
      const isExhausted = nextAttempts >= 5;
      await db.query(
        'UPDATE email_otps SET attempts = $1, is_used = $2 WHERE id = $3',
        [nextAttempts, isExhausted, activeOtp.id]
      );

      if (isExhausted) {
        return res.status(429).json({
          success: false,
          message: 'Too many failed verification attempts. This reset code has been deactivated. Please request a new one.',
        });
      }

      return res.status(400).json({
        success: false,
        message: `Invalid password reset code. ${5 - nextAttempts} attempts remaining.`,
      });
    }

    await db.query('UPDATE email_otps SET is_used = true WHERE id = $1', [activeOtp.id]);

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

/**
 * Customer Google OAuth Controller
 * Verifies Google ID token (credential) or Google OAuth2 accessToken,
 * finds or registers the user in PostgreSQL, and issues platform JWT.
 */
export const googleLoginUser = async (req, res) => {
  try {
    const { credential, accessToken } = req.body;

    if (!credential && !accessToken) {
      return res.status(400).json({
        success: false,
        message: 'Google authentication credential or access token is required.',
      });
    }

    let googleUser = null;

    // 1. Verify via ID Token (Credential)
    if (credential) {
      const verifyRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
      );
      const data = await verifyRes.json();

      if (!verifyRes.ok || data.error) {
        return res.status(401).json({
          success: false,
          message: data.error_description || 'Invalid or expired Google credential.',
        });
      }

      const expectedClientId =
        process.env.GOOGLE_CLIENT_ID ||
        '237399104322-0bbsognkgnb8d9dshehjl8roeb6fvdkv.apps.googleusercontent.com';
      if (data.aud !== expectedClientId) {
        console.warn(`[Google OAuth Warning] Token audience ${data.aud} did not match expected client ID.`);
      }

      if (data.email_verified !== 'true' && data.email_verified !== true) {
        return res.status(400).json({
          success: false,
          message: 'Google email address is not verified.',
        });
      }

      googleUser = {
        googleId: data.sub,
        email: String(data.email).toLowerCase().trim(),
        firstName: data.given_name || (data.name ? data.name.split(' ')[0] : 'User'),
        lastName: data.family_name || (data.name ? data.name.split(' ').slice(1).join(' ') : null),
        picture: data.picture || null,
      };
    } else if (accessToken) {
      // 2. Verify via Access Token
      const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await userinfoRes.json();

      if (!userinfoRes.ok || data.error) {
        return res.status(401).json({
          success: false,
          message: data.error_description || 'Invalid or expired Google access token.',
        });
      }

      if (!data.email) {
        return res.status(400).json({
          success: false,
          message: 'Unable to retrieve email from Google profile.',
        });
      }

      googleUser = {
        googleId: data.sub,
        email: String(data.email).toLowerCase().trim(),
        firstName: data.given_name || (data.name ? data.name.split(' ')[0] : 'User'),
        lastName: data.family_name || (data.name ? data.name.split(' ').slice(1).join(' ') : null),
        picture: data.picture || null,
      };
    }

    if (!googleUser || !googleUser.email) {
      return res.status(400).json({
        success: false,
        message: 'Failed to extract profile information from Google.',
      });
    }

    // 3. Find existing user by google_id or email
    const { rows: existingRows } = await db.query(
      `SELECT id, email, first_name, last_name, phone, gender, date_of_birth, status, profile_image_url, google_id
       FROM users
       WHERE google_id = $1 OR LOWER(email) = $2
       LIMIT 1`,
      [googleUser.googleId, googleUser.email]
    );

    let user = null;
    let isNewUser = false;

    if (existingRows.length > 0) {
      user = existingRows[0];

      if (user.status !== 1) {
        return res.status(403).json({
          success: false,
          message: 'Your account has been deactivated. Please contact support.',
        });
      }

      // Update google_id, profile image if missing, and last_login_at
      await db.query(
        `UPDATE users
         SET google_id = COALESCE(google_id, $1),
             profile_image_url = COALESCE(profile_image_url, $2),
             last_login_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [googleUser.googleId, googleUser.picture, user.id]
      );
    } else {
      // 4. Create new user with Google profile
      isNewUser = true;
      const insertQuery = `
        INSERT INTO users (
          email,
          password_hash,
          role,
          status,
          first_name,
          last_name,
          profile_image_url,
          google_id,
          last_login_at,
          created_at,
          updated_at
        ) VALUES ($1, NULL, 1, 1, $2, $3, $4, $5, NOW(), NOW(), NOW())
        RETURNING id, email, first_name, last_name, phone, gender, date_of_birth, role, status, profile_image_url, created_at;
      `;

      const insertValues = [
        googleUser.email,
        googleUser.firstName,
        googleUser.lastName,
        googleUser.picture,
        googleUser.googleId,
      ];

      const newRes = await db.query(insertQuery, insertValues);
      user = newRes.rows[0];

      // Trigger welcome email in background
      emailService
        .sendWelcomeEmail({ email: googleUser.email, firstName: googleUser.firstName })
        .catch((err) => {
          console.warn('Notice: Background Google welcome email:', err.message);
        });
    }

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

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });

    return res.json({
      success: true,
      message: isNewUser
        ? 'Account created and signed in with Google successfully!'
        : 'Logged in with Google successfully.',
      token,
      isNewUser,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        gender: user.gender,
        dateOfBirth: user.date_of_birth,
        profileImageUrl: user.profile_image_url || googleUser.picture,
        role: 'Customer',
        address: addrRes.rows[0] || null,
      },
    });
  } catch (err) {
    console.error('Google OAuth Controller Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to authenticate with Google.',
    });
  }
};


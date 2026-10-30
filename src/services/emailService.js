import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_PATH = path.join(__dirname, '../assets/logo-white.png');

function getStandardAttachments() {
  if (fs.existsSync(LOGO_PATH)) {
    return [
      {
        filename: 'logo.png',
        path: LOGO_PATH,
        cid: 'shoplogo@makerspacemasters',
      },
    ];
  }
  return [];
}

// Initialize Transporter using Makerspace Masters SMTP Credentials from Environment
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

const SENDER_EMAIL = process.env.SMTP_FROM || 'makerspacemasters.com';
const SENDER_NAME = process.env.SMTP_FROM_NAME || 'Makerspace Masters';

/**
 * Generate standard HTML template layout
 */
function getEmailLayout({ title, previewText, bodyContent }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f4f6f8;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f4f6f8;
      padding: 40px 16px;
      box-sizing: border-box;
    }
    .container {
      max-width: 560px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
      border: 1px solid #e2e8f0;
    }
    .header {
      background: linear-gradient(135deg, #002740 0%, #004b7a 100%);
      padding: 32px 24px;
      text-align: center;
      color: #ffffff;
    }
    .header-tag {
      display: inline-block;
      background: rgba(255, 255, 255, 0.18);
      color: #ffffff;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      padding: 4px 12px;
      border-radius: 20px;
      margin-bottom: 12px;
    }
    .header-title {
      font-size: 22px;
      font-weight: 900;
      letter-spacing: -0.5px;
      margin: 0;
      color: #ffffff;
      text-transform: uppercase;
    }
    .header-sub {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.85);
      margin-top: 6px;
    }
    .content {
      padding: 36px 32px;
      line-height: 1.6;
    }
    .otp-box {
      margin: 28px 0;
      padding: 24px;
      background: #f8fafc;
      border: 2px dashed #0071e3;
      border-radius: 12px;
      text-align: center;
    }
    .otp-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #64748b;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .otp-code {
      font-size: 36px;
      font-weight: 900;
      letter-spacing: 10px;
      color: #002740;
      font-family: 'Courier New', Courier, monospace;
      margin: 4px 0;
      padding-left: 10px;
    }
    .otp-expiry {
      font-size: 11px;
      color: #e11d48;
      font-weight: 600;
      margin-top: 8px;
    }
    .info-card {
      background: #f1f5f9;
      border-left: 4px solid #0071e3;
      padding: 12px 16px;
      border-radius: 6px;
      font-size: 12px;
      color: #475569;
      margin: 20px 0;
    }
    .footer {
      background: #f8fafc;
      padding: 24px 32px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
    }
    .footer a {
      color: #0071e3;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div style="display:none;font-size:1px;color:#333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${previewText}
  </div>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div style="margin-bottom: 6px; text-align: center;">
          <img src="cid:shoplogo@makerspacemasters" alt="Makerspace Shop" style="height: 42px; width: auto; max-width: 220px; display: inline-block; vertical-align: middle; border: 0;" />
        </div>
        <div class="header-sub">Hardware &amp; STEM Innovation Hub</div>
      </div>
      <div class="content">
        ${bodyContent}
      </div>
      <div class="footer">
        <p style="margin: 0 0 6px 0;">This email was sent by <strong>Makerspace Masters</strong>.</p>
        <p style="margin: 0 0 6px 0;">For inquiries or security assistance, contact <a href="mailto:${SENDER_EMAIL}">${SENDER_EMAIL}</a>.</p>
        <p style="margin: 0; color: #cbd5e1;">© ${new Date().getFullYear()} Makerspace Masters. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Send 6-Digit Email Login OTP
 */
export async function sendLoginOtpEmail({ email, otp, firstName = 'Maker' }) {
  const subject = `Makerspace Login Code: ${otp}`;
  const previewText = `Login verification code is ${otp}. Valid for 10 minutes.`;

  const bodyContent = `
    <h2 style="font-size: 18px; font-weight: 800; color: #002740; margin-top: 0; margin-bottom: 8px;">
      Hello ${firstName},
    </h2>
    <p style="font-size: 13px; color: #475569; margin: 0 0 16px 0;">
      We received a request to log in to your <strong>Makerspace Masters</strong> account using this email address. Please use the one-time verification code below to complete your sign in:
    </p>

    <div class="otp-box">
      <div class="otp-label">One-Time Verification Code</div>
      <div class="otp-code">${otp}</div>
      <div class="otp-expiry">Valid for 10 minutes only</div>
    </div>

    <div class="info-card">
      <strong>Security Notice:</strong> Never share this code with anyone. Makerspace Masters staff will never ask for your verification code. If you did not initiate this request, you can safely disregard this email.
    </div>

    <p style="font-size: 12px; color: #64748b; margin-top: 24px; margin-bottom: 0;">
      Happy Making,<br>
      <strong>The Makerspace Masters Team</strong>
    </p>
  `;

  const html = getEmailLayout({
    title: subject,
    previewText,
    bodyContent,
  });

  const mailOptions = {
    from: `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
    to: email,
    subject,
    html,
    text: `Your Makerspace Masters Login Code is: ${otp}. It is valid for 10 minutes. If you did not request this, please ignore this email.`,
    attachments: getStandardAttachments(),
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

/**
 * Send Welcome Email after successful registration
 */
export async function sendWelcomeEmail({ email, firstName = 'Maker' }) {
  const subject = `Welcome to Makerspace Masters, ${firstName}!`;
  const previewText = `Welcome to Makerspace Masters! Explore 3D printers, robotics kits, and STEM tools.`;

  const bodyContent = `
    <h2 style="font-size: 18px; font-weight: 800; color: #002740; margin-top: 0; margin-bottom: 8px;">
      Welcome to Makerspace Masters, ${firstName}!
    </h2>
    <p style="font-size: 13px; color: #475569; margin: 0 0 16px 0;">
      Your account has been successfully created. You now have full access to high-performance hardware, STEM robotics kits, curriculum modules, and rapid tech solutions.
    </p>

    <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid #e2e8f0;">
      <h3 style="font-size: 14px; font-weight: 800; color: #002740; margin: 0 0 10px 0;">What you can do next:</h3>
      <ul style="font-size: 12px; color: #475569; padding-left: 20px; margin: 0; line-height: 1.8;">
        <li>Explore over 20+ specialized maker and robotics categories</li>
        <li>Build bespoke engineering projects with Master Series kits</li>
        <li>Manage your shipping addresses and fast 1-click checkout</li>
        <li>Track orders in real-time from dispatch to delivery</li>
      </ul>
    </div>

    <div style="text-align: center; margin: 28px 0;">
      <a href="http://localhost:3000/user" style="display: inline-block; background: #002740; color: #ffffff; padding: 12px 28px; border-radius: 8px; font-size: 13px; font-weight: 700; text-decoration: none;">
        Start Exploring Products &rarr;
      </a>
    </div>

    <p style="font-size: 12px; color: #64748b; margin-top: 24px; margin-bottom: 0;">
      Warm regards,<br>
      <strong>The Makerspace Masters Team</strong>
    </p>
  `;

  const html = getEmailLayout({
    title: subject,
    previewText,
    bodyContent,
  });

  const mailOptions = {
    from: `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
    to: email,
    subject,
    html,
    text: `Welcome to Makerspace Masters, ${firstName}! Your account is now active.`,
    attachments: getStandardAttachments(),
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

/**
 * Send Order Confirmation Email with line items, address, and pricing breakdown
 */
export async function sendOrderConfirmationEmail({
  email,
  customerName = 'Maker',
  orderNumber,
  items = [],
  totalAmount = 0,
  subtotal = 0,
  shippingFee = 0,
  tax = 0,
  paymentMethod = 'Online Payment',
  paymentStatus = 'Paid',
  shippingAddress = '',
  shippingCity = '',
  shippingState = '',
  shippingPostalCode = '',
  shippingCountry = 'India',
  createdAt = new Date(),
}) {
  const subject = `Order Confirmed #${orderNumber} - Makerspace Masters`;
  const formatINR = (val) =>
    `₹${parseFloat(val || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const formattedDate = new Date(createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const previewText = `Thank you for your order #${orderNumber}! Total: ${formatINR(totalAmount)}. We're getting it ready.`;

  const addressParts = [
    shippingAddress,
    shippingCity,
    shippingState ? `${shippingState} ${shippingPostalCode || ''}`.trim() : shippingPostalCode,
    shippingCountry,
  ].filter(Boolean);
  const formattedAddress = addressParts.join(', ');

  const itemsHtml = (items || [])
    .map((item) => {
      const itemPrice = parseFloat(item.price || 0);
      const itemQty = parseInt(item.quantity || 1, 10);
      const lineTotal = parseFloat(item.lineTotal || item.totalPrice || itemPrice * itemQty);
      return `
        <tr>
          <td style="padding: 12px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: middle;">
            <div style="font-weight: 700; color: #002740; font-size: 13px;">${item.name || 'Maker Item'}</div>
            ${item.sku ? `<div style="font-size: 11px; color: #64748b; margin-top: 2px;">SKU: ${item.sku}</div>` : ''}
          </td>
          <td style="padding: 12px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; color: #475569; font-size: 12px; vertical-align: middle;">
            ${itemQty}
          </td>
          <td style="padding: 12px 8px; border-bottom: 1px solid #e2e8f0; text-align: right; color: #475569; font-size: 12px; vertical-align: middle;">
            ${formatINR(itemPrice)}
          </td>
          <td style="padding: 12px 8px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 700; color: #002740; font-size: 13px; vertical-align: middle;">
            ${formatINR(lineTotal)}
          </td>
        </tr>
      `;
    })
    .join('');

  const bodyContent = `
    <h2 style="font-size: 18px; font-weight: 800; color: #002740; margin-top: 0; margin-bottom: 8px;">
      Thank You for Your Order, ${customerName}!
    </h2>
    <p style="font-size: 13px; color: #475569; margin: 0 0 20px 0; line-height: 1.5;">
      We've received your order <strong>#${orderNumber}</strong> and our team is already working on preparing it for dispatch. You can track your order status in your account at any time.
    </p>

    <!-- Order Metadata Card -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <tr>
          <td style="padding: 4px 0; color: #64748b;">Order Number:</td>
          <td style="padding: 4px 0; text-align: right; font-weight: 800; color: #002740; font-family: monospace; font-size: 13px;">${orderNumber}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #64748b;">Order Date:</td>
          <td style="padding: 4px 0; text-align: right; font-weight: 600; color: #334155;">${formattedDate}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #64748b;">Payment Method:</td>
          <td style="padding: 4px 0; text-align: right; font-weight: 600; color: #334155;">${paymentMethod}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #64748b;">Payment Status:</td>
          <td style="padding: 4px 0; text-align: right; font-weight: 700; color: #059669;">${paymentStatus}</td>
        </tr>
      </table>
    </div>

    <!-- Delivery Address Card -->
    ${
      formattedAddress
        ? `
      <div style="margin-bottom: 24px;">
        <h3 style="font-size: 13px; font-weight: 800; color: #002740; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px 0;">
          Shipping Address
        </h3>
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; font-size: 12px; color: #334155; line-height: 1.5;">
          <strong>${customerName}</strong><br>
          ${formattedAddress}
        </div>
      </div>
    `
        : ''
    }

    <!-- Ordered Items Table -->
    <div style="margin-bottom: 24px;">
      <h3 style="font-size: 13px; font-weight: 800; color: #002740; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 10px 0;">
        Items in This Order
      </h3>
      <table style="width: 100%; border-collapse: collapse; margin-top: 6px;">
        <thead>
          <tr style="background: #f1f5f9; text-align: left; font-size: 11px; text-transform: uppercase; color: #475569;">
            <th style="padding: 8px; font-weight: 700;">Item</th>
            <th style="padding: 8px; font-weight: 700; text-align: center;">Qty</th>
            <th style="padding: 8px; font-weight: 700; text-align: right;">Price</th>
            <th style="padding: 8px; font-weight: 700; text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
    </div>

    <!-- Pricing Summary -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <tr>
          <td style="padding: 4px 0; color: #64748b;">Subtotal:</td>
          <td style="padding: 4px 0; text-align: right; color: #334155; font-weight: 600;">${formatINR(subtotal || totalAmount)}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #64748b;">Shipping Fee:</td>
          <td style="padding: 4px 0; text-align: right; font-weight: 600; color: ${shippingFee > 0 ? '#334155' : '#059669'};">
            ${shippingFee > 0 ? formatINR(shippingFee) : 'FREE'}
          </td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #64748b;">Taxes (GST):</td>
          <td style="padding: 4px 0; text-align: right; color: #334155; font-weight: 600;">${formatINR(tax || 0)}</td>
        </tr>
        <tr style="border-top: 2px solid #e2e8f0;">
          <td style="padding: 10px 0 0 0; font-size: 14px; font-weight: 900; color: #002740;">Total Amount:</td>
          <td style="padding: 10px 0 0 0; text-align: right; font-size: 16px; font-weight: 900; color: #0071e3;">${formatINR(totalAmount)}</td>
        </tr>
      </table>
    </div>

    <!-- Call to action button -->
    <div style="text-align: center; margin: 32px 0 20px 0;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/user/orders" style="display: inline-block; background: #002740; color: #ffffff; padding: 14px 32px; border-radius: 10px; font-size: 13px; font-weight: 800; text-decoration: none; box-shadow: 0 4px 12px rgba(0, 39, 64, 0.2);">
        View & Track Your Order &rarr;
      </a>
    </div>

    <p style="font-size: 12px; color: #64748b; margin-top: 24px; margin-bottom: 0; line-height: 1.6;">
      Need any help with your shipment? Reach out to us at <a href="mailto:${SENDER_EMAIL}" style="color: #0071e3; text-decoration: underline;">${SENDER_EMAIL}</a>.<br>
      Thank you for shopping with <strong>Makerspace Masters</strong>!
    </p>
  `;

  const html = getEmailLayout({
    title: subject,
    previewText,
    bodyContent,
  });

  const mailOptions = {
    from: `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
    to: email,
    subject,
    html,
    text: `Thank you for your order #${orderNumber}! Total: ${formatINR(totalAmount)}. Track your order at ${process.env.FRONTEND_URL || 'http://localhost:3000'}/user/orders.`,
    attachments: getStandardAttachments(),
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

/**
 * Send Order Status Update Email (Shipped, Delivered, Processing, Cancelled, etc.)
 */
export async function sendOrderStatusUpdateEmail({
  email,
  customerName = 'Maker',
  orderNumber,
  newStatus = 'Processing',
  oldStatus,
  paymentStatus = 'Paid',
  deliveryDate,
  items = [],
  totalAmount = 0,
  subtotal = 0,
  shippingFee = 0,
  tax = 0,
  shippingAddress = '',
  shippingCity = '',
  shippingState = '',
  shippingPostalCode = '',
  shippingCountry = 'India',
}) {
  const formatINR = (val) =>
    `₹${parseFloat(val || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const formatDate = (dateVal) => {
    if (!dateVal) return '';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  const statusKey = String(newStatus || '').trim().toLowerCase();
  const cleanOrderNumber = String(orderNumber || '').replace(/^#/, '');
  const displayOrderNumber = cleanOrderNumber ? `#${cleanOrderNumber}` : '';

  const STATUS_MAP = {
    shipped: {
      subject: `Order Has Been Shipped: ${displayOrderNumber}`,
      title: 'Order Has Been Shipped',
      headline: 'Package is On The Way',
      badgeBg: '#eff6ff',
      badgeText: '#1d4ed8',
      badgeBorder: '#bfdbfe',
      dateLabel: 'Estimated Delivery Date',
      description: `Great news! Package for order <strong>${displayOrderNumber}</strong> has been shipped and is on its way to you. Our logistics partner is processing the shipment.`,
    },
    delivered: {
      subject: `Order Has Been Delivered: ${displayOrderNumber}`,
      title: 'Order Has Been Delivered',
      headline: 'Package Successfully Delivered',
      badgeBg: '#f0fdf4',
      badgeText: '#15803d',
      badgeBorder: '#bbf7d0',
      dateLabel: 'Delivered On',
      description: `Order <strong>${displayOrderNumber}</strong> has been successfully delivered. We hope you enjoy working with your hardware and STEM innovation kit!`,
    },
    processing: {
      subject: `Order is Being Processed: ${displayOrderNumber}`,
      title: 'Order is Being Processed',
      headline: 'Preparing Hardware',
      badgeBg: '#fffbeb',
      badgeText: '#b45309',
      badgeBorder: '#fde68a',
      dateLabel: 'Estimated Dispatch',
      description: `We're currently assembling, quality checking, and packing order <strong>${displayOrderNumber}</strong>. We will notify you as soon as it ships.`,
    },
    cancelled: {
      subject: `Order Has Been Cancelled: ${displayOrderNumber}`,
      title: 'Order Has Been Cancelled',
      headline: 'Order Cancelled',
      badgeBg: '#fef2f2',
      badgeText: '#b91c1c',
      badgeBorder: '#fecaca',
      dateLabel: null,
      description: `Order <strong>${displayOrderNumber}</strong> has been cancelled. If any payment was captured, a full refund will be processed back to your original payment method.`,
    },
    pending: {
      subject: `Order Received: ${displayOrderNumber}`,
      title: 'Order Status: Pending Confirmation',
      headline: 'Awaiting Order Confirmation',
      badgeBg: '#f8fafc',
      badgeText: '#475569',
      badgeBorder: '#cbd5e1',
      dateLabel: null,
      description: `Order <strong>${displayOrderNumber}</strong> is currently pending review by our fulfillment team.`,
    },
  };

  const config = STATUS_MAP[statusKey] || {
    subject: `Order Status: ${displayOrderNumber} - ${newStatus}`,
    title: `Order Status: ${newStatus}`,
    headline: `Status Updated to ${newStatus}`,
    badgeBg: '#f1f5f9',
    badgeText: '#334155',
    badgeBorder: '#cbd5e1',
    dateLabel: 'Delivery Date',
    description: `The status of order <strong>${displayOrderNumber}</strong> has been updated to <strong>${newStatus}</strong>.`,
  };

  const subject = config.subject;
  const previewText = `Update on order ${displayOrderNumber}: Status is now ${newStatus}. ${config.headline}.`;

  const formattedDeliveryDate = deliveryDate ? formatDate(deliveryDate) : '';

  const addressParts = [
    shippingAddress,
    shippingCity,
    shippingState ? `${shippingState} ${shippingPostalCode || ''}`.trim() : shippingPostalCode,
    shippingCountry,
  ].filter(Boolean);
  const formattedAddress = addressParts.join(', ');

  const itemsHtml = (items || [])
    .map((item) => {
      const itemPrice = parseFloat(item.price || 0);
      const itemQty = parseInt(item.quantity || 1, 10);
      const lineTotal = parseFloat(item.totalPrice || item.lineTotal || itemPrice * itemQty);
      return `
        <tr>
          <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: middle;">
            <div style="font-weight: 700; color: #002740; font-size: 13px;">${item.name || 'Maker Item'}</div>
            ${item.sku ? `<div style="font-size: 11px; color: #64748b; margin-top: 2px;">SKU: ${item.sku}</div>` : ''}
          </td>
          <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; color: #475569; font-size: 12px; vertical-align: middle;">
            ${itemQty}
          </td>
          <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 700; color: #002740; font-size: 13px; vertical-align: middle;">
            ${formatINR(lineTotal)}
          </td>
        </tr>
      `;
    })
    .join('');

  const bodyContent = `
    <h2 style="font-size: 18px; font-weight: 800; color: #002740; margin-top: 0; margin-bottom: 8px;">
      Hello ${customerName},
    </h2>
    <p style="font-size: 13px; color: #475569; margin: 0 0 20px 0; line-height: 1.5;">
      ${config.description}
    </p>

    <!-- Status Card -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 16px; text-align: center; margin-bottom: 24px;">
      <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 8px;">
        Current Status
      </div>
      <div style="display: inline-block; padding: 8px 22px; border-radius: 20px; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; background: ${config.badgeBg}; color: ${config.badgeText}; border: 1px solid ${config.badgeBorder};">
        ${newStatus}
      </div>
      ${
        formattedDeliveryDate && config.dateLabel
          ? `
        <div style="font-size: 12px; color: #475569; margin-top: 10px; font-weight: 500;">
          ${config.dateLabel}: <strong style="color: #002740;">${formattedDeliveryDate}</strong>
        </div>
      `
          : ''
      }
    </div>

    <!-- Order Summary Details -->
    <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <tr>
          <td style="padding: 5px 0; color: #64748b;">Order Number:</td>
          <td style="padding: 5px 0; text-align: right; font-weight: 800; color: #002740; font-family: monospace; font-size: 13px;">${orderNumber}</td>
        </tr>
        ${
          oldStatus && oldStatus.toLowerCase() !== newStatus.toLowerCase()
            ? `
        <tr>
          <td style="padding: 5px 0; color: #64748b;">Previous Status:</td>
          <td style="padding: 5px 0; text-align: right; font-weight: 600; color: #64748b;">${oldStatus}</td>
        </tr>
        `
            : ''
        }
        <tr>
          <td style="padding: 5px 0; color: #64748b;">Payment Status:</td>
          <td style="padding: 5px 0; text-align: right; font-weight: 700; color: ${paymentStatus === 'Paid' ? '#059669' : paymentStatus === 'Refunded' ? '#dc2626' : '#d97706'};">
            ${paymentStatus || 'Paid'}
          </td>
        </tr>
        ${
          totalAmount > 0
            ? `
        <tr>
          <td style="padding: 5px 0; color: #64748b;">Total Amount:</td>
          <td style="padding: 5px 0; text-align: right; font-weight: 800; color: #002740;">${formatINR(totalAmount)}</td>
        </tr>
        `
            : ''
        }
      </table>
    </div>

    <!-- Delivery Address Card -->
    ${
      formattedAddress
        ? `
      <div style="margin-bottom: 24px;">
        <h3 style="font-size: 13px; font-weight: 800; color: #002740; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px 0;">
          Destination Address
        </h3>
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; font-size: 12px; color: #334155; line-height: 1.5;">
          <strong>${customerName}</strong><br>
          ${formattedAddress}
        </div>
      </div>
    `
        : ''
    }

    <!-- Ordered Items Table -->
    ${
      items && items.length > 0
        ? `
      <div style="margin-bottom: 24px;">
        <h3 style="font-size: 13px; font-weight: 800; color: #002740; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 10px 0;">
          Items in this Order
        </h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 6px;">
          <thead>
            <tr style="background: #f1f5f9; text-align: left; font-size: 11px; text-transform: uppercase; color: #475569;">
              <th style="padding: 8px; font-weight: 700;">Item</th>
              <th style="padding: 8px; font-weight: 700; text-align: center;">Qty</th>
              <th style="padding: 8px; font-weight: 700; text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
      </div>
    `
        : ''
    }

    <!-- CTA Button -->
    <div style="text-align: center; margin: 32px 0 20px 0;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/user/orders" style="display: inline-block; background: #002740; color: #ffffff; padding: 14px 32px; border-radius: 10px; font-size: 13px; font-weight: 800; text-decoration: none; box-shadow: 0 4px 12px rgba(0, 39, 64, 0.2);">
        Track & View Order Details &rarr;
      </a>
    </div>

    <p style="font-size: 12px; color: #64748b; margin-top: 24px; margin-bottom: 0; line-height: 1.6;">
      Need any assistance with this order or shipment? Reach out to us at <a href="mailto:${SENDER_EMAIL}" style="color: #0071e3; text-decoration: underline;">${SENDER_EMAIL}</a>.<br>
      Thank you for shopping with <strong>Makerspace Masters</strong>!
    </p>
  `;

  const html = getEmailLayout({
    title: subject,
    previewText,
    bodyContent,
  });

  const mailOptions = {
    from: `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
    to: email,
    subject,
    html,
    text: `Order #${orderNumber} status is now: ${newStatus}. View tracking at ${process.env.FRONTEND_URL || 'http://localhost:3000'}/user/orders.`,
    attachments: getStandardAttachments(),
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

/**
 * Send Administrator Portal Login Credentials
 */
export async function sendAdminCredentialsEmail({
  email,
  firstName = 'Administrator',
  password,
  roleName = 'ADMIN',
  loginUrl,
}) {
  const portalUrl = loginUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/makerspace/admin`;
  const subject = `Administrator Portal Access: Credentials - Makerspace Masters`;
  const previewText = `Login credentials for your Makerspace Masters administrator account.`;

  const bodyContent = `
    <h2 style="font-size: 18px; font-weight: 800; color: #002740; margin-top: 0; margin-bottom: 8px;">
      Hello ${firstName},
    </h2>
    <p style="font-size: 13px; color: #475569; margin: 0 0 16px 0; line-height: 1.6;">
      An administrator account has been set up for you on the <strong>Makerspace Masters</strong> management portal. Your login credentials and access details are provided below:
    </p>

    <!-- Credentials Card -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 24px 0;">
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 8px 0; color: #64748b; font-weight: 600; width: 38%;">Portal URL:</td>
          <td style="padding: 8px 0; color: #002740; font-weight: 700;">
            <a href="${portalUrl}" style="color: #0071e3; text-decoration: none;">${portalUrl}</a>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748b; font-weight: 600;">Login ID (Email):</td>
          <td style="padding: 8px 0; color: #002740; font-weight: 700; font-family: monospace; font-size: 14px;">
            ${email}
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748b; font-weight: 600;">Password:</td>
          <td style="padding: 8px 0;">
            <span style="display: inline-block; background: #e0e7ff; color: #3730a3; font-family: 'Courier New', Courier, monospace; font-size: 15px; font-weight: 800; letter-spacing: 1px; padding: 4px 10px; border-radius: 6px; border: 1px solid #c7d2fe;">
              ${password}
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748b; font-weight: 600;">Assigned Role:</td>
          <td style="padding: 8px 0; color: #002740; font-weight: 700;">
            ${roleName}
          </td>
        </tr>
      </table>
    </div>

    <!-- Security Notice -->
    <div class="info-card">
      <strong>Important Security Reminder:</strong> Please keep these credentials confidential. We recommend logging in promptly and updating your password under <strong>Settings &gt; Admin Profile</strong> to ensure account security.
    </div>

    <!-- CTA Button -->
    <div style="text-align: center; margin: 28px 0 20px 0;">
      <a href="${portalUrl}" style="display: inline-block; background: #002740; color: #ffffff; padding: 14px 32px; border-radius: 10px; font-size: 13px; font-weight: 800; text-decoration: none; box-shadow: 0 4px 12px rgba(0, 39, 64, 0.2);">
        Sign In to Admin Portal &rarr;
      </a>
    </div>

    <p style="font-size: 12px; color: #64748b; margin-top: 24px; margin-bottom: 0;">
      Regards,<br>
      <strong>Makerspace Masters Administration</strong>
    </p>
  `;

  const html = getEmailLayout({
    title: subject,
    previewText,
    bodyContent,
  });

  const mailOptions = {
    from: `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
    to: email,
    subject,
    html,
    text: `Administrator account created on Makerspace Masters portal.\n\nPortal URL: ${portalUrl}\nLogin ID: ${email}\nPassword: ${password}\nRole: ${roleName}\n\nPlease sign in and update your password immediately.`,
    attachments: getStandardAttachments(),
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

export default {
  transporter,
  sendLoginOtpEmail,
  sendWelcomeEmail,
  sendOrderConfirmationEmail,
  sendOrderStatusUpdateEmail,
  sendAdminCredentialsEmail,
};


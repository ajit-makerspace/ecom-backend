
import crypto from 'node:crypto';
import db from '../../config/db.js';

const RAZORPAY_BASE_URL = 'https://api.razorpay.com/v1';

const getRazorpayAuth = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials are not configured.');
  }

  return {
    keyId,
    keySecret,
    authorization: `Basic ${Buffer.from(
      `${keyId}:${keySecret}`
    ).toString('base64')}`,
  };
};

const razorpayRequest = async (url, options = {}) => {
  const { authorization } = getRazorpayAuth();

  const response = await fetch(`${RAZORPAY_BASE_URL}${url}`, {
    ...options,
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error?.description || 'Razorpay API request failed.'
    );
  }

  return data;
};

const isValidId = (id) =>
  /^\d+$/.test(String(id)) && Number(id) > 0;

const sendError = (res, status, message, extra = {}) =>
  res.status(status).json({
    success: false,
    message,
    ...extra,
  });

/**
 * 1. CREATE RAZORPAY ORDER
 *
 * POST /print-requests/:id/payment/create-order
 *
 * The payment record is created during print request creation.
 * This endpoint only creates/reuses its Razorpay order.
 */

export const createPrintRequestPaymentOrder = async (req, res) => {
  let client;
  let transactionStarted = false;

  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return sendError(res, 401, 'Authentication required.');
    }

    if (!isValidId(id)) {
      return sendError(res, 400, 'Invalid print request ID.');
    }

    client = await db.pool.connect();

    await client.query('BEGIN');
    transactionStarted = true;

    // Lock the order to prevent simultaneous payment attempts.
    const requestResult = await client.query(
      `
      SELECT
        id,
        user_id,
        order_number,
        total_amount,
        order_status,
        checkout_expires_at
      FROM print_requests
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [id, userId]
    );

    if (!requestResult.rows.length) {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return sendError(res, 404, 'Print request not found.');
    }

    const request = requestResult.rows[0];

    if (request.order_status !== 'pending_payment') {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return sendError(
        res,
        409,
        'This print request is not awaiting payment.',
        { currentStatus: request.order_status }
      );
    }

    // Validate checkout expiry.
    const expiryResult = await client.query(
      `
      SELECT checkout_expires_at > NOW() AS is_valid
      FROM print_requests
      WHERE id = $1
      `,
      [id]
    );

    if (!expiryResult.rows[0]?.is_valid) {
      await client.query(
        `
        UPDATE print_requests
        SET
          order_status = 'cancelled',
          updated_at = NOW()
        WHERE id = $1
          AND order_status = 'pending_payment'
        `,
        [id]
      );

      await client.query('COMMIT');
      transactionStarted = false;

      return sendError(
        res,
        410,
        'Checkout has expired. Please create a new print request.'
      );
    }

    // Convert the order amount from rupees to paise.
    const amountInPaise = Math.round(
      Number(request.total_amount) * 100
    );

    if (
      !Number.isSafeInteger(amountInPaise) ||
      amountInPaise <= 0
    ) {
      throw new Error('Invalid print request amount.');
    }

    // Retrieve the latest payment attempt.
    const latestPaymentResult = await client.query(
      `
      SELECT *
      FROM print_request_payments
      WHERE print_request_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [id]
    );

    let payment;

    if (latestPaymentResult.rows.length > 0) {
      payment = latestPaymentResult.rows[0];

      // An already-paid order cannot be paid again.
      if (payment.status === 'paid') {
        await client.query('ROLLBACK');
        transactionStarted = false;

        return sendError(
          res,
          409,
          'This print request has already been paid.'
        );
      }

      if (payment.status === 'refunded') {
        await client.query('ROLLBACK');
        transactionStarted = false;

        return sendError(
          res,
          409,
          'This payment has already been refunded. Please contact support.'
        );
      }

      // Only pending or failed attempts are valid here.
      if (!['pending', 'failed'].includes(payment.status)) {
        await client.query('ROLLBACK');
        transactionStarted = false;

        return sendError(
          res,
          409,
          'Invalid payment attempt status.'
        );
      }

      if (Number(payment.amount) !== amountInPaise) {
        throw new Error(
          'Payment amount does not match the print request total.'
        );
      }

      // If the latest attempt failed, create a new attempt.
      if (payment.status === 'failed') {
        const newPaymentResult = await client.query(
          `
          INSERT INTO print_request_payments (
            print_request_id,
            amount,
            currency,
            status
          )
          VALUES ($1, $2, 'INR', 'pending')
          RETURNING *
          `,
          [id, amountInPaise]
        );

        payment = newPaymentResult.rows[0];
      }
    } else {
      // Payment record should normally be created during order creation.
      await client.query('ROLLBACK');
      transactionStarted = false;

      return sendError(
        res,
        409,
        'Payment record is missing. Please contact support.'
      );
    }

    const { keyId } = getRazorpayAuth();

    // Reuse the Razorpay order for an existing pending attempt.
    if (payment.razorpay_order_id) {
      await client.query('COMMIT');
      transactionStarted = false;

      return res.status(200).json({
        success: true,
        message: 'Existing payment order retrieved.',
        payment: {
          paymentId: payment.id,
          printRequestId: request.id,
          orderNumber: request.order_number,
          amount: amountInPaise,
          amountInRupees: Number(request.total_amount),
          currency: payment.currency,
          razorpayOrderId: payment.razorpay_order_id,
          keyId,
        },
      });
    }

    // Create a Razorpay order for this payment attempt.
    const razorpayOrder = await razorpayRequest('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `print_${request.id}_${payment.id}`,
        notes: {
          type: '3D_PRINTING',
          print_request_id: String(request.id),
          order_number: String(request.order_number),
          payment_id: String(payment.id),
          user_id: String(userId),
        },
      }),
    });

    // Attach Razorpay order to the payment attempt.
    const updatedPayment = await client.query(
      `
      UPDATE print_request_payments
      SET
        razorpay_order_id = $1,
        updated_at = NOW()
      WHERE id = $2
        AND status = 'pending'
      RETURNING *
      `,
      [razorpayOrder.id, payment.id]
    );

    if (!updatedPayment.rows.length) {
      throw new Error('Unable to save Razorpay order.');
    }

    await client.query('COMMIT');
    transactionStarted = false;

    return res.status(201).json({
      success: true,
      message: 'Payment order created successfully.',
      payment: {
        paymentId: payment.id,
        printRequestId: request.id,
        orderNumber: request.order_number,
        amount: amountInPaise,
        amountInRupees: Number(request.total_amount),
        currency: 'INR',
        razorpayOrderId: razorpayOrder.id,
        keyId,
      },
    });
  } catch (error) {
    if (transactionStarted && client) {
      await client.query('ROLLBACK');
      transactionStarted = false;
    }

    console.error('Create Print Payment Order Error:', error);

    return sendError(
      res,
      500,
      error.message || 'Failed to create payment order.'
    );
  } finally {
    if (client) client.release();
  }
};


/**
 * 2. VERIFY RAZORPAY PAYMENT
 *
 * POST /print-requests/:id/payment/verify
 *
 * Only captured payments can confirm an order.
 */

export const verifyPrintRequestPayment = async (req, res) => {
  let client;
  let transactionStarted = false;

  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!userId) {
      return sendError(res, 401, 'Authentication required.');
    }

    if (!isValidId(id)) {
      return sendError(res, 400, 'Invalid print request ID.');
    }

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return sendError(
        res,
        400,
        'Missing Razorpay verification parameters.'
      );
    }

    // 1. Verify Razorpay signature.
    const { keySecret } = getRazorpayAuth();

    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const receivedBuffer = Buffer.from(
      String(razorpay_signature),
      'hex'
    );

    if (
      expectedBuffer.length !== receivedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
      return sendError(
        res,
        400,
        'Invalid Razorpay payment signature.'
      );
    }

    // 2. Find payment record and verify ownership.
    const lookup = await db.query(
      `
      SELECT
        p.id AS payment_id,
        p.print_request_id,
        p.razorpay_order_id,
        p.razorpay_payment_id,
        p.amount,
        p.currency,
        p.status AS payment_status,
        pr.user_id
      FROM print_request_payments p
      INNER JOIN print_requests pr
        ON pr.id = p.print_request_id
      WHERE p.print_request_id = $1
        AND p.razorpay_order_id = $2
        AND pr.user_id = $3
      LIMIT 1
      `,
      [id, razorpay_order_id, userId]
    );

    if (!lookup.rows.length) {
      return sendError(res, 404, 'Payment record not found.');
    }

    const existingPayment = lookup.rows[0];

    // 3. Retrieve actual payment information from Razorpay.
    const razorpayPayment = await razorpayRequest(
      `/payments/${encodeURIComponent(razorpay_payment_id)}`,
      { method: 'GET' }
    );

    if (
      razorpayPayment.id !== razorpay_payment_id ||
      razorpayPayment.order_id !== razorpay_order_id
    ) {
      return sendError(
        res,
        400,
        'Payment does not belong to the supplied Razorpay order.'
      );
    }

    if (
      Number(razorpayPayment.amount) !== Number(existingPayment.amount) ||
      razorpayPayment.currency !== existingPayment.currency
    ) {
      return sendError(
        res,
        400,
        'Payment amount or currency mismatch.'
      );
    }

    // Only captured payments can confirm an order.
    if (razorpayPayment.status === 'authorized') {
      return sendError(
        res,
        409,
        'Payment is authorized but not yet captured. Please wait for payment confirmation.',
        { razorpayStatus: 'authorized' }
      );
    }

    if (razorpayPayment.status === 'failed') {
      return sendError(
        res,
        400,
        'Razorpay confirms that this payment failed.',
        { razorpayStatus: 'failed' }
      );
    }

    if (razorpayPayment.status !== 'captured') {
      return sendError(
        res,
        409,
        'Payment has not been captured yet.',
        { razorpayStatus: razorpayPayment.status }
      );
    }

    // 4. Begin transaction.
    client = await db.pool.connect();

    await client.query('BEGIN');
    transactionStarted = true;

    // Lock request first. All payment operations should use
    // this same lock order to avoid deadlocks.
    const requestResult = await client.query(
      `
      SELECT
        id,
        user_id,
        order_number,
        order_status,
        checkout_expires_at
      FROM print_requests
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [id, userId]
    );

    if (!requestResult.rows.length) {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return sendError(res, 404, 'Print request not found.');
    }

    const printRequest = requestResult.rows[0];

    // Lock payment attempt.
    const paymentResult = await client.query(
      `
      SELECT *
      FROM print_request_payments
      WHERE id = $1
        AND print_request_id = $2
      FOR UPDATE
      `,
      [existingPayment.payment_id, id]
    );

    if (!paymentResult.rows.length) {
      throw new Error('Payment attempt not found.');
    }

    const payment = paymentResult.rows[0];

    // 5. Idempotency: same successful payment.
    if (payment.status === 'paid') {
      if (payment.razorpay_payment_id !== razorpay_payment_id) {
        await client.query('ROLLBACK');
        transactionStarted = false;

        return sendError(
          res,
          409,
          'This payment attempt has already been completed using another payment ID.'
        );
      }

      await client.query('COMMIT');
      transactionStarted = false;

      return res.status(200).json({
        success: true,
        message: 'Payment already verified.',
        isDuplicate: true,
        paymentId: payment.id,
        printRequest: {
          id: printRequest.id,
          orderNumber: printRequest.order_number,
          orderStatus: printRequest.order_status,
        },
      });
    }

    // Check whether the payment ID has been used by another record.
    const duplicateCheck = await client.query(
      `
      SELECT id
      FROM print_request_payments
      WHERE razorpay_payment_id = $1
        AND id <> $2
      LIMIT 1
      `,
      [razorpay_payment_id, payment.id]
    );

    if (duplicateCheck.rows.length) {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return sendError(
        res,
        409,
        'This payment ID has already been processed.'
      );
    }

    // A captured payment must be recorded even if a previous
    // frontend callback incorrectly marked this attempt failed.
    if (!['pending', 'failed'].includes(payment.status)) {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return sendError(
        res,
        409,
        'This payment attempt cannot be updated.',
        { currentPaymentStatus: payment.status }
      );
    }

    // 6. Record the actual captured payment.
    const updatedPayment = await client.query(
      `
      UPDATE print_request_payments
      SET
        razorpay_payment_id = $1,
        status = 'paid',
        payment_method = $2,
        failure_reason = NULL,
        updated_at = NOW()
      WHERE id = $3
        AND status IN ('pending', 'failed')
      RETURNING *
      `,
      [
        razorpay_payment_id,
        razorpayPayment.method || 'razorpay',
        payment.id,
      ]
    );

    if (!updatedPayment.rows.length) {
      throw new Error('Unable to record captured payment.');
    }

    let orderConfirmed = false;
    let reconciliationRequired = false;

    // 7. Confirm only an active, unexpired checkout.
    if (printRequest.order_status === 'pending_payment') {
      const expiryResult = await client.query(
        `
        SELECT
          checkout_expires_at,
          checkout_expires_at > NOW() AS is_valid
        FROM print_requests
        WHERE id = $1
        `,
        [id]
      );

      const isValid =
        expiryResult.rows[0]?.checkout_expires_at &&
        expiryResult.rows[0]?.is_valid;

      if (isValid) {
        const updatedRequest = await client.query(
          `
          UPDATE print_requests
          SET
            order_status = 'confirmed',
            updated_at = NOW()
          WHERE id = $1
            AND order_status = 'pending_payment'
          RETURNING id
          `,
          [id]
        );

        orderConfirmed = updatedRequest.rows.length > 0;
      } else {
        // Preserve the real captured payment, but do not
        // resurrect an expired checkout.
        await client.query(
          `
          UPDATE print_requests
          SET
            order_status = 'cancelled',
            updated_at = NOW()
          WHERE id = $1
            AND order_status = 'pending_payment'
          `,
          [id]
        );

        reconciliationRequired = true;
      }
    }  else {
  // The order is no longer awaiting payment.
  // A captured payment against an already confirmed or
  // cancelled order needs reconciliation.
  reconciliationRequired = true;
}

    await client.query('COMMIT');
    transactionStarted = false;

    return res.status(200).json({
      success: true,
      message: reconciliationRequired
        ? 'Payment captured and recorded. Order requires payment reconciliation.'
        : 'Payment verified successfully.',
      isDuplicate: false,
      reconciliationRequired,
      orderConfirmed,
      printRequest: {
        id: printRequest.id,
        orderNumber: printRequest.order_number,
        orderStatus: orderConfirmed
          ? 'confirmed'
          : printRequest.order_status === 'pending_payment'
            ? 'cancelled'
            : printRequest.order_status,
      },
      payment: updatedPayment.rows[0],
    });
  } catch (error) {
    if (transactionStarted && client) {
      await client.query('ROLLBACK');
      transactionStarted = false;
    }

    console.error('Verify Print Payment Error:', error);

    return sendError(
      res,
      500,
      error.message || 'Payment verification failed.'
    );
  } finally {
    if (client) client.release();
  }
};


/**
 * 3. RECORD FAILED PAYMENT
 *
 * POST /print-requests/:id/payment/failure
 *
 * This endpoint records a failure reported by Razorpay Checkout.
 * It never changes the order status.
 */

export const recordPrintRequestPaymentFailure = async (req, res) => {
  let client;
  let transactionStarted = false;

  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const {
      razorpay_order_id,
      error_description,
      error_reason,
      error_code,
    } = req.body;

    if (!userId) {
      return sendError(res, 401, 'Authentication required.');
    }

    if (!isValidId(id)) {
      return sendError(res, 400, 'Invalid print request ID.');
    }

    if (!razorpay_order_id) {
      return sendError(
        res,
        400,
        'Razorpay order ID is required.'
      );
    }

    // 1. Validate payment ownership.
    const lookup = await db.query(
      `
      SELECT
        p.id,
        p.print_request_id,
        p.razorpay_order_id,
        p.razorpay_payment_id,
        p.status,
        pr.user_id
      FROM print_request_payments p
      INNER JOIN print_requests pr
        ON pr.id = p.print_request_id
      WHERE p.print_request_id = $1
        AND p.razorpay_order_id = $2
        AND pr.user_id = $3
      LIMIT 1
      `,
      [id, razorpay_order_id, userId]
    );

    if (!lookup.rows.length) {
      return sendError(res, 404, 'Payment attempt not found.');
    }

    const paymentAttempt = lookup.rows[0];

    // Already paid: never overwrite it.
    if (paymentAttempt.status === 'paid') {
      return res.status(200).json({
        success: true,
        message: 'Payment is already marked as paid.',
        isDuplicate: true,
        paymentId: paymentAttempt.id,
      });
    }

    if (paymentAttempt.status === 'refunded') {
      return sendError(
        res,
        409,
        'This payment has already been refunded.'
      );
    }

    if (paymentAttempt.status === 'failed') {
      return res.status(200).json({
        success: true,
        message: 'Payment failure was already recorded.',
        isDuplicate: true,
        paymentId: paymentAttempt.id,
      });
    }

    // 2. Check actual payment status with Razorpay.
    const razorpayOrderPayments = await razorpayRequest(
      `/orders/${encodeURIComponent(razorpay_order_id)}/payments`,
      { method: 'GET' }
    );

    const razorpayPayments = razorpayOrderPayments.items || [];

    const capturedPayment = razorpayPayments.find(
      (item) => item.status === 'captured'
    );

    if (capturedPayment) {
      return res.status(409).json({
        success: false,
        message:
          'Razorpay reports a captured payment. Do not mark this attempt as failed. Verify and reconcile the captured payment.',
        razorpayStatus: 'captured',
        razorpayPaymentId: capturedPayment.id,
      });
    }

    const authorizedPayment = razorpayPayments.find(
      (item) => item.status === 'authorized'
    );

    if (authorizedPayment) {
      return res.status(409).json({
        success: false,
        message:
          'Payment is authorized but not captured. Payment remains pending.',
        razorpayStatus: 'authorized',
        razorpayPaymentId: authorizedPayment.id,
      });
    }

    const pendingPayment = razorpayPayments.find(
      (item) =>
        item.status === 'created' ||
        item.status === 'pending'
    );

    if (pendingPayment) {
      return res.status(409).json({
        success: false,
        message:
          'Razorpay payment is still processing. Payment remains pending.',
        razorpayStatus: pendingPayment.status,
      });
    }

    // No payment records or an unknown status is not sufficient
    // evidence to permanently mark the attempt failed.
    const allPaymentsFailed =
      razorpayPayments.length > 0 &&
      razorpayPayments.every((item) => item.status === 'failed');

    if (!allPaymentsFailed) {
      return res.status(409).json({
        success: false,
        message:
          'Payment outcome could not be confirmed. Payment remains pending.',
        razorpayStatus: 'unknown',
      });
    }

    // 3. Only now record the failure.
    client = await db.pool.connect();

    await client.query('BEGIN');
    transactionStarted = true;

    // Follow the same lock order as payment verification.
    const requestResult = await client.query(
      `
      SELECT id, user_id
      FROM print_requests
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [id, userId]
    );

    if (!requestResult.rows.length) {
      throw new Error('Print request not found.');
    }

    const lockedPayment = await client.query(
      `
      SELECT *
      FROM print_request_payments
      WHERE id = $1
        AND print_request_id = $2
      FOR UPDATE
      `,
      [paymentAttempt.id, id]
    );

    if (!lockedPayment.rows.length) {
      throw new Error('Payment attempt not found.');
    }

    const payment = lockedPayment.rows[0];

    // Another request may have updated the payment meanwhile.
    if (payment.status === 'paid') {
      await client.query('COMMIT');
      transactionStarted = false;

      return res.status(200).json({
        success: true,
        message: 'Payment is already marked as paid.',
        isDuplicate: true,
        paymentId: payment.id,
      });
    }

    if (payment.status === 'failed') {
      await client.query('COMMIT');
      transactionStarted = false;

      return res.status(200).json({
        success: true,
        message: 'Payment failure was already recorded.',
        isDuplicate: true,
        paymentId: payment.id,
      });
    }

    if (payment.status !== 'pending') {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return sendError(
        res,
        409,
        'Payment attempt is no longer pending.',
        { currentPaymentStatus: payment.status }
      );
    }

    const failureReason =
      error_description ||
      error_reason ||
      error_code ||
      'Payment failed or cancelled by customer';

    const updatedPayment = await client.query(
      `
      UPDATE print_request_payments
      SET
        status = 'failed',
        failure_reason = $1,
        updated_at = NOW()
      WHERE id = $2
        AND status = 'pending'
      RETURNING *
      `,
      [
        String(failureReason).slice(0, 1000),
        payment.id,
      ]
    );

    if (!updatedPayment.rows.length) {
      throw new Error('Unable to record payment failure.');
    }

    await client.query('COMMIT');
    transactionStarted = false;

    return res.status(200).json({
      success: true,
      message: 'Payment failure recorded successfully.',
      payment: updatedPayment.rows[0],
    });
  } catch (error) {
    if (transactionStarted && client) {
      await client.query('ROLLBACK');
      transactionStarted = false;
    }

    console.error('Print Payment Failure Error:', error);

    return sendError(
      res,
      500,
      error.message || 'Failed to record payment failure.'
    );
  } finally {
    if (client) client.release();
  }
};

/**
 * 4. GET PAYMENT HISTORY
 *
 * GET /print-requests/:id/payment
 */
export const getPrintRequestPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return sendError(res, 401, 'Authentication required.');
    }

    if (!isValidId(id)) {
      return sendError(res, 400, 'Invalid print request ID.');
    }

    const { rows } = await db.query(
      `
      SELECT
        p.id,
        p.print_request_id,
        p.razorpay_order_id,
        p.razorpay_payment_id,
        p.amount,
        p.currency,
        p.status,
        p.payment_method,
        p.failure_reason,
        p.created_at,
        p.updated_at
      FROM print_request_payments p
      INNER JOIN print_requests pr
        ON pr.id = p.print_request_id
      WHERE p.print_request_id = $1
        AND pr.user_id = $2
      ORDER BY p.created_at DESC
      `,
      [id, userId]
    );

    return res.status(200).json({
      success: true,
      count: rows.length,
      payments: rows,
    });
  } catch (error) {
    console.error('Get Print Request Payment Error:', error);

    return sendError(
      res,
      500,
      'Failed to retrieve print request payment details.'
    );
  }
};

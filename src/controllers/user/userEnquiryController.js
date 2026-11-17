import db from '../../config/db.js';

export const createBulkEnquiry = async (req, res) => {
  try {
    const {
      fullName,
      companyName,
      email,
      phone,
      category,
      estimatedQuantity,
      targetDate,
      budget,
      gstin,
      city,
      pincode,
      requirements,
      items,
    } = req.body;

    if (!fullName || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and phone number are required for submitting a bulk enquiry.',
      });
    }

    const userId = req.user?.id || null;
    const year = new Date().getFullYear();
    const randomCode = Math.floor(100000 + Math.random() * 900000);
    const referenceNo = `ENQ-${year}-${randomCode}`;

    const insertQuery = `
      INSERT INTO bulk_enquiries (
        reference_no,
        user_id,
        full_name,
        company_name,
        email,
        phone,
        category,
        estimated_quantity,
        target_date,
        budget,
        gstin,
        city,
        pincode,
        requirements,
        items,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'PENDING')
      RETURNING id, reference_no, created_at;
    `;

    const values = [
      referenceNo,
      userId,
      fullName.trim(),
      companyName ? companyName.trim() : null,
      email.toLowerCase().trim(),
      phone.trim(),
      category || 'General Bulk Inquiry',
      estimatedQuantity || '50+',
      targetDate || null,
      budget || null,
      gstin ? gstin.trim().toUpperCase() : null,
      city ? city.trim() : null,
      pincode ? pincode.trim() : null,
      requirements ? requirements.trim() : '',
      JSON.stringify(items || []),
    ];

    const result = await db.query(insertQuery, values);
    const saved = result.rows[0];

    console.log(`[Bulk Enquiry] Received #${referenceNo} from ${fullName} (${email}, ${phone})`);

    return res.status(201).json({
      success: true,
      message: 'Your bulk enquiry has been received successfully! Our enterprise team will connect with you shortly.',
      referenceNo: saved.reference_no,
      enquiryId: saved.id,
      createdAt: saved.created_at,
    });
  } catch (err) {
    console.error('Error submitting bulk enquiry:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit bulk enquiry. Please try again or reach out to sales directly.',
    });
  }
};

export const getBulkEnquiriesAdmin = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM bulk_enquiries ORDER BY created_at DESC LIMIT 100`
    );
    return res.json({
      success: true,
      enquiries: rows,
    });
  } catch (err) {
    console.error('Error fetching bulk enquiries:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch bulk enquiries.',
    });
  }
};

-- =============================================================================
-- Database Migration: Repair Missing Relations & Indexes
-- Target DB: ecom (Port 5432)
-- =============================================================================

-- 1. Refresh Tokens (Required for Dual-Token Auth, Silent Renewal & Rotation)
CREATE TABLE IF NOT EXISTS public.refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_type SMALLINT NOT NULL DEFAULT 2, -- 1: Admin, 2: Customer
    user_id UUID NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent TEXT,
    ip_address VARCHAR(45)
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON public.refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON public.refresh_tokens(user_type, user_id);

-- 2. Brand Logos (Required for Product Queries & Storefront Ribbons)
CREATE TABLE IF NOT EXISTS public.brand_logos (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    logo_url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status SMALLINT NOT NULL DEFAULT 1, -- 1: Active, 0: Inactive, 2: Deleted
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brand_logos_status_sort ON public.brand_logos(status, sort_order);

-- 3. Customer Logos (Required for Admin Customer Ribbon)
CREATE TABLE IF NOT EXISTS public.customer_logos (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    logo_url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_logos_status_sort ON public.customer_logos(status, sort_order);

-- 4. Blogs (Required for Admin and User Blog Endpoints)
CREATE TABLE IF NOT EXISTS public.blogs (
    id SERIAL PRIMARY KEY,
    main_heading VARCHAR(255) NOT NULL,
    sub_heading TEXT,
    last_update DATE NOT NULL DEFAULT CURRENT_DATE,
    reading_time INTEGER NOT NULL DEFAULT 5,
    description TEXT,
    image_url TEXT,
    sections JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blogs_is_active ON public.blogs(is_active);

-- 5. Bulk Enquiries (Required for Storefront Bulk Order Forms)
CREATE TABLE IF NOT EXISTS public.bulk_enquiries (
    id SERIAL PRIMARY KEY,
    reference_no VARCHAR(64) NOT NULL UNIQUE,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    full_name VARCHAR(150) NOT NULL,
    company_name VARCHAR(150),
    email VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    category VARCHAR(100),
    estimated_quantity INTEGER,
    target_date DATE,
    budget VARCHAR(100),
    gstin VARCHAR(30),
    city VARCHAR(100),
    pincode VARCHAR(20),
    requirements TEXT,
    items JSONB DEFAULT '[]'::jsonb,
    file_url TEXT,
    file_name VARCHAR(255),
    media_id INTEGER REFERENCES public.media_files(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bulk_enquiries_email ON public.bulk_enquiries(LOWER(email));

-- 6. 3D Print Requests & Quotations (Required for 3D Printing Service)
CREATE TABLE IF NOT EXISTS public.print_requests (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    media_id INTEGER REFERENCES public.media_files(id) ON DELETE SET NULL,
    user_address_id INTEGER REFERENCES public.user_addresses(id) ON DELETE SET NULL,
    material VARCHAR(100),
    color_mode VARCHAR(50),
    color_hex VARCHAR(20),
    quality VARCHAR(50),
    quantity INTEGER NOT NULL DEFAULT 1,
    scale NUMERIC(5,2) DEFAULT 1.0,
    units VARCHAR(20) DEFAULT 'mm',
    instructions TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending_review',
    accepted_quotation_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_print_requests_user ON public.print_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_print_requests_status ON public.print_requests(status);

CREATE TABLE IF NOT EXISTS public.print_request_files (
    id SERIAL PRIMARY KEY,
    print_request_id INTEGER NOT NULL REFERENCES public.print_requests(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES public.media_files(id) ON DELETE CASCADE,
    file_role VARCHAR(50) DEFAULT 'support',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.print_request_quotations (
    id SERIAL PRIMARY KEY,
    print_request_id INTEGER NOT NULL REFERENCES public.print_requests(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL DEFAULT 1,
    amount NUMERIC(12,2) NOT NULL,
    material_cost NUMERIC(12,2) DEFAULT 0.00,
    printing_cost NUMERIC(12,2) DEFAULT 0.00,
    shipping_cost NUMERIC(12,2) DEFAULT 0.00,
    estimated_days INTEGER DEFAULT 7,
    admin_notes TEXT,
    created_by_admin_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_print_quotations_req ON public.print_request_quotations(print_request_id);

CREATE TABLE IF NOT EXISTS public.print_request_payments (
    id SERIAL PRIMARY KEY,
    print_request_id INTEGER NOT NULL REFERENCES public.print_requests(id) ON DELETE CASCADE,
    quotation_id INTEGER REFERENCES public.print_request_quotations(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'INR',
    razorpay_order_id VARCHAR(100),
    razorpay_payment_id VARCHAR(100),
    razorpay_signature VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'created',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. User GST Numbers
CREATE TABLE IF NOT EXISTS public.user_gst_numbers (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    gstin VARCHAR(20) NOT NULL,
    legal_name VARCHAR(200) NOT NULL,
    trade_name VARCHAR(200),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_gst_user_id ON public.user_gst_numbers(user_id);

-- 8. Add Missing Foreign Key Indexes
CREATE INDEX IF NOT EXISTS idx_user_addresses_user_id ON public.user_addresses(user_id);

-- 9. Drop Plaintext Password Column (Security Hardening)
ALTER TABLE public.admin_users DROP COLUMN IF EXISTS plain_password;

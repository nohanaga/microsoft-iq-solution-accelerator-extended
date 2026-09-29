BEGIN;

CREATE SCHEMA IF NOT EXISTS maikuro;

CREATE TABLE IF NOT EXISTS maikuro.suppliers (
    supplier_id text PRIMARY KEY CHECK (length(btrim(supplier_id)) > 0),
    name text NOT NULL,
    city text NOT NULL
);

CREATE TABLE IF NOT EXISTS maikuro.stores (
    store_id text PRIMARY KEY CHECK (length(btrim(store_id)) > 0),
    name text NOT NULL UNIQUE,
    city text NOT NULL,
    cold_equipment boolean,
    cups_per_day integer CHECK (cups_per_day >= 0)
);

CREATE TABLE IF NOT EXISTS maikuro.products (
    product_id text PRIMARY KEY CHECK (length(btrim(product_id)) > 0),
    name text NOT NULL,
    category text NOT NULL,
    price_ex_tax integer NOT NULL CHECK (price_ex_tax >= 0),
    tax_percent numeric(5,2) NOT NULL CHECK (tax_percent BETWEEN 0 AND 100),
    volume text NOT NULL,
    supplier_id text REFERENCES maikuro.suppliers(supplier_id),
    display_order integer NOT NULL UNIQUE CHECK (display_order >= 0),
    attributes jsonb NOT NULL CHECK (jsonb_typeof(attributes) = 'object'),
    data_origin text NOT NULL DEFAULT 'synthetic' CHECK (data_origin IN ('synthetic', 'production')),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE VIEW maikuro.ec_catalogue AS
SELECT product_id, display_order,
       attributes || jsonb_build_object(
           'id', product_id,
           'name', name,
           'category', category,
           'net', price_ex_tax,
           'tax', tax_percent / 100,
           'volume', volume
       ) AS product
FROM maikuro.products;

CREATE TABLE IF NOT EXISTS maikuro.orders (
    order_id uuid PRIMARY KEY,
    order_number text NOT NULL UNIQUE CHECK (length(btrim(order_number)) > 0),
    request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
    customer_id text NOT NULL DEFAULT 'CUS-EC-GUEST' CHECK (length(btrim(customer_id)) > 0),
    store_id text NOT NULL REFERENCES maikuro.stores(store_id),
    ordered_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    pickup_at timestamptz NOT NULL,
    received_at timestamptz,
    status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'received', 'cancelled')),
    subtotal_ex_tax integer NOT NULL CHECK (subtotal_ex_tax >= 0),
    tax_amount integer NOT NULL CHECK (tax_amount >= 0),
    total_amount integer NOT NULL CHECK (total_amount = subtotal_ex_tax + tax_amount),
    currency text NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
    source text NOT NULL DEFAULT 'ec' CHECK (source = 'ec'),
    CHECK (pickup_at > ordered_at),
    CHECK ((status = 'received') = (received_at IS NOT NULL)),
    UNIQUE (order_id, request_fingerprint)
);

CREATE TABLE IF NOT EXISTS maikuro.order_lines (
    order_line_id uuid PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES maikuro.orders(order_id) ON DELETE CASCADE,
    line_number integer NOT NULL CHECK (line_number > 0),
    product_id text NOT NULL REFERENCES maikuro.products(product_id),
    product_name text NOT NULL CHECK (length(btrim(product_name)) > 0),
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price_ex_tax integer NOT NULL CHECK (unit_price_ex_tax >= 0),
    tax_percent numeric(5,2) NOT NULL CHECK (tax_percent BETWEEN 0 AND 100),
    subtotal_ex_tax integer NOT NULL CHECK (subtotal_ex_tax = unit_price_ex_tax * quantity),
    tax_amount integer NOT NULL CHECK (tax_amount >= 0),
    total_amount integer NOT NULL CHECK (total_amount = subtotal_ex_tax + tax_amount),
    UNIQUE (order_id, line_number)
);

CREATE INDEX IF NOT EXISTS orders_store_ordered_at_idx
    ON maikuro.orders (store_id, ordered_at DESC);

CREATE INDEX IF NOT EXISTS order_lines_order_id_idx
    ON maikuro.order_lines (order_id, line_number);

CREATE TABLE IF NOT EXISTS maikuro.rayfin_outbox (
    event_id uuid PRIMARY KEY,
    aggregate_id uuid NOT NULL REFERENCES maikuro.orders(order_id) ON DELETE CASCADE,
    event_type text NOT NULL CHECK (event_type IN ('order.confirmed', 'order.received', 'order.cancelled')),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error text,
    UNIQUE (aggregate_id, event_type)
);

CREATE INDEX IF NOT EXISTS rayfin_outbox_pending_idx
    ON maikuro.rayfin_outbox (occurred_at)
    WHERE published_at IS NULL;

COMMIT;
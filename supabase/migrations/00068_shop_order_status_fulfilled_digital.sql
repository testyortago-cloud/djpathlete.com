-- supabase/migrations/00068_shop_order_status_fulfilled_digital.sql
-- Phase 2: digital-only orders skip POD states and terminate at 'fulfilled_digital'.

ALTER TYPE shop_order_status ADD VALUE IF NOT EXISTS 'fulfilled_digital';

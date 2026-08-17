-- Lead inquiries: store every Google/Meta click identifier, not just gclid.
--
-- `lead_inquiries` shipped (00182) with a lone `gclid` column, and the inquiry
-- form filled it from a first-party cookie. Two consequences showed up in
-- production: gbraid/wbraid clicks — the iOS/privacy segment, 101 distinct
-- values in `marketing_attribution` — had nowhere to land at all, and every
-- cookie-loss path silently wrote NULL. Result: 337 Google-Ads sessions, 0
-- attributed inquiries, and 0 rows ever uploaded back to Google.
--
-- `marketing_attribution` already captures all four ids server-side, so these
-- columns give the inquiry row somewhere to copy them to.

ALTER TABLE lead_inquiries
  ADD COLUMN IF NOT EXISTS gbraid TEXT,
  ADD COLUMN IF NOT EXISTS wbraid TEXT,
  ADD COLUMN IF NOT EXISTS fbclid TEXT;

-- Partial indexes: conversion-upload jobs scan for "inquiries carrying a click
-- id", which is a small minority of rows.
CREATE INDEX IF NOT EXISTS idx_lead_inquiries_gclid
  ON lead_inquiries (gclid) WHERE gclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_inquiries_gbraid
  ON lead_inquiries (gbraid) WHERE gbraid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_inquiries_wbraid
  ON lead_inquiries (wbraid) WHERE wbraid IS NOT NULL;

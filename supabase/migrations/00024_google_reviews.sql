-- Imported Google Business Profile reviews (manual import via admin UI)
CREATE TABLE public.google_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_name text NOT NULL,
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  review_date timestamptz NOT NULL DEFAULT now(),
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: only service-role (admin server actions) can access
ALTER TABLE public.google_reviews ENABLE ROW LEVEL SECURITY;

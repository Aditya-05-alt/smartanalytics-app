-- Normalize GA4 channel labels for VDP filter matching
-- ("Organic Search" ≡ "organic_search", "Cross-network" ≡ "cross-network").

CREATE OR REPLACE FUNCTION public.vdp_channel_key(p_channel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(btrim(COALESCE(p_channel, '')), '[\s\-]+', '_', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.vdp_channel_matches(
  p_channel text,
  p_channels text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    COALESCE(array_length(p_channels, 1), 0) = 0
    OR lower(regexp_replace(btrim(COALESCE(p_channel, '')), '[\s\-]+', '_', 'g'))
       = ANY (
         SELECT lower(regexp_replace(btrim(c), '[\s\-]+', '_', 'g'))
         FROM unnest(p_channels) AS c
       );
$$;

-- True when a final-data VDP row has GA4 page traffic in any selected channel.
CREATE OR REPLACE FUNCTION public.vdp_final_matches_channels(
  p_client_id text,
  p_report_date date,
  p_page_path text,
  p_channels text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(array_length(p_channels, 1), 0) = 0
    OR EXISTS (
      SELECT 1
      FROM public.smart_ga4_page_data p
      WHERE p.client_id::text = trim(p_client_id)
        AND p.report_date = p_report_date
        AND TRIM(COALESCE(p.page_path, '')) = TRIM(COALESCE(p_page_path, ''))
        AND p.vdp_conditions IS TRUE
        AND public.vdp_channel_matches(p.channel, p_channels)
    );
$$;

GRANT EXECUTE ON FUNCTION public.vdp_channel_key(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vdp_channel_matches(text, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vdp_final_matches_channels(text, date, text, text[])
  TO anon, authenticated, service_role;

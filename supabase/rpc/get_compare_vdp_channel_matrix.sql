-- Compare page ONLY — VDP channel matrix from ga4_compare_vdp_channel_daily.
-- Does not change Overview / All Dealers RPCs.

DROP FUNCTION IF EXISTS public.get_compare_vdp_channel_matrix(date, date, text[]);

CREATE OR REPLACE FUNCTION public.get_compare_vdp_channel_matrix(
  p_from date,
  p_to date,
  p_client_ids text[] DEFAULT NULL
)
RETURNS TABLE (
  client_id text,
  dealer_name text,
  channel_bucket text,
  views bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
DECLARE
  v_chunked boolean := COALESCE(array_length(p_client_ids, 1), 0) > 0;
  v_cov_from date;
  v_cov_to date;
  v_eff_to date;
  v_ready boolean := false;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid date range: % .. %', p_from, p_to;
  END IF;

  SELECT MIN(report_date), MAX(report_date)
  INTO v_cov_from, v_cov_to
  FROM public.ga4_compare_vdp_channel_daily;

  -- Clamp to available agg coverage (MTD often ends after last synced day).
  v_eff_to := LEAST(p_to, COALESCE(v_cov_to, p_to));
  -- Use agg when the window overlaps covered range (zero-view days need no rows).
  v_ready := v_cov_from IS NOT NULL
    AND v_cov_to IS NOT NULL
    AND v_cov_from <= p_from
    AND v_eff_to >= p_from;

  RETURN QUERY
  WITH dealers AS (
    SELECT DISTINCT ON (h.ga4_customer_id)
      h.ga4_customer_id::text AS dealer_client_id,
      h.customer_name AS dealer_label
    FROM public.smart_hoot_config h
    WHERE h.is_active IS TRUE
      AND h.ga4_customer_id IS NOT NULL
      AND h.ga4_customer_id::text <> ''
      AND (NOT v_chunked OR h.ga4_customer_id::text = ANY (p_client_ids))
    ORDER BY h.ga4_customer_id, h.id DESC
  ),
  raw AS (
    SELECT g.client_id, g.channel, SUM(g.views)::bigint AS views
    FROM public.ga4_compare_vdp_channel_daily g
    WHERE COALESCE(v_ready, false)
      AND g.report_date BETWEEN p_from AND v_eff_to
      AND (NOT v_chunked OR g.client_id = ANY (p_client_ids))
    GROUP BY g.client_id, g.channel

    UNION ALL

    SELECT p.client_id, p.channel, SUM(COALESCE(p.views, 0))::bigint
    FROM public.smart_ga4_page_data p
    WHERE NOT COALESCE(v_ready, false)
      AND p.report_date BETWEEN p_from AND p_to
      AND p.vdp_conditions IS TRUE
      AND (NOT v_chunked OR p.client_id = ANY (p_client_ids))
    GROUP BY p.client_id, p.channel
  ),
  normalized AS (
    SELECT
      r.client_id AS dealer_client_id,
      CASE lower(trim(COALESCE(r.channel, '')))
        WHEN 'organic_search'  THEN 'Organic Search'
        WHEN 'paid_search'     THEN 'Paid Search'
        WHEN 'direct'          THEN 'Direct'
        WHEN 'organic_social'  THEN 'Organic Social'
        WHEN 'paid_social'     THEN 'Paid Social'
        WHEN 'paid_video'      THEN 'Paid Video'
        WHEN 'organic_video'   THEN 'Organic Video'
        WHEN 'display'         THEN 'Display'
        WHEN 'email'           THEN 'Email'
        WHEN 'referral'        THEN 'Referral'
        WHEN 'affiliates'      THEN 'Affiliates'
        WHEN 'paid_other'      THEN 'Paid Other'
        WHEN 'sms'             THEN 'SMS'
        WHEN 'audio'           THEN 'Audio'
        WHEN 'cross-network'   THEN 'Cross-network'
        WHEN 'unassigned'      THEN 'Unassigned'
        WHEN ''                THEN '(not set)'
        ELSE initcap(replace(replace(lower(trim(r.channel)), '_', ' '), '-', ' '))
      END AS norm_channel,
      r.views
    FROM raw r
  )
  SELECT
    n.dealer_client_id,
    d.dealer_label,
    n.norm_channel,
    SUM(n.views)::bigint AS channel_views
  FROM normalized n
  INNER JOIN dealers d ON d.dealer_client_id = n.dealer_client_id
  GROUP BY n.dealer_client_id, d.dealer_label, n.norm_channel
  HAVING SUM(n.views) > 0
  ORDER BY d.dealer_label, channel_views DESC, n.norm_channel;
END;
$$;

REVOKE ALL ON FUNCTION public.get_compare_vdp_channel_matrix(date, date, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_compare_vdp_channel_matrix(date, date, text[])
  TO anon, authenticated, service_role;

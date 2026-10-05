-- Independent Unknown/Other cleanup (not Step 1/2/3).
-- Match smart_vdp_logic_2 → update smart_final_data.
-- Record each fix in smart_unknown_vdp_links (the notebook) as status 'matched' so
-- it survives the nightly Step 3 rebuild via apply_logic2_notebook_replay, and skip
-- URLs already recorded there so this only ever works the left-out ones.
-- Leftover paths → smart_exception_data.
-- Catalogs: smart_make, smart_models, smart_custom_unknown_fillers.
--
-- Depends on: 20260917_logic2_notebook_prepare.sql (unique index on
-- (client_id, page_path), inv_custom_type, fix_source).

CREATE OR REPLACE FUNCTION public.logic2_slugify(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    trim(both '-' FROM regexp_replace(lower(COALESCE(p, '')), '[^a-z0-9]+', '-', 'g')),
    ''
  );
$$;

-- Filler makes were pasted from URLs, so some carry a percent-encoded ® / ™.
CREATE OR REPLACE FUNCTION public.logic2_clean_make(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    btrim(regexp_replace(regexp_replace(COALESCE(p, ''), '%C2%AE', '®', 'gi'), '%E2%84%A2', '™', 'gi')),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_logic2_unknown_cleanup(
  p_client_id text,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text := btrim(p_client_id);
  v_logic text;
  v_cms text;
  v_name text;
  v_site text;
  v_matched int := 0;
  v_filled_make int := 0;
  v_filled_model int := 0;
  v_filled_type int := 0;
  v_filled_filler_make int := 0;
  v_filled_filler_type int := 0;
  v_exceptions int := 0;
  v_cleared int := 0;
  v_noted int := 0;
BEGIN
  IF v_id IS NULL OR v_id = '' OR p_from IS NULL OR p_to IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;

  SELECT
    NULLIF(btrim(vdp_logic), ''),
    NULLIF(btrim(cms), ''),
    NULLIF(btrim(dealer_name), ''),
    NULLIF(btrim(website_url), '')
  INTO v_logic, v_cms, v_name, v_site
  FROM public.smart_vdp_logic_2
  WHERE dealer_id = v_id
  LIMIT 1;

  IF v_name IS NULL THEN
    SELECT MIN(account_name) INTO v_name
    FROM public.smart_final_data
    WHERE client_id = v_id
      AND report_date BETWEEN p_from AND p_to;
  END IF;

  CREATE TEMP TABLE tmp_unk_paths (
    page_path text PRIMARY KEY,
    page_location text,
    views bigint
  ) ON COMMIT DROP;

  INSERT INTO tmp_unk_paths (page_path, page_location, views)
  SELECT
    f.page_path,
    MAX(NULLIF(btrim(f.page_location), '')) AS page_location,
    SUM(COALESCE(f.views, 0))::bigint AS views
  FROM public.smart_final_data f
  WHERE f.client_id = v_id
    AND f.report_date BETWEEN p_from AND p_to
    AND f.page_path IS NOT NULL
    AND btrim(f.page_path) <> ''
    AND (
      NULLIF(btrim(f.inv_url), '') IS NULL
      OR f.vdp_conditions IS DISTINCT FROM TRUE
      OR NULLIF(btrim(f.inv_make), '') IS NULL
      OR lower(btrim(f.inv_make)) IN ('unknown', 'other')
    )
    -- Already solved and recorded, so apply_logic2_notebook_replay owns it now.
    -- Logic 2 only ever works the genuinely left-out URLs.
    AND NOT EXISTS (
      SELECT 1
      FROM public.smart_unknown_vdp_links n
      WHERE n.client_id = v_id
        AND n.page_path = f.page_path
        AND n.status IN ('matched', 'applied')
    )
  GROUP BY f.page_path;

  CREATE TEMP TABLE tmp_matched (
    page_path text PRIMARY KEY,
    page_location text
  ) ON COMMIT DROP;

  IF v_logic IS NOT NULL THEN
    INSERT INTO tmp_matched (page_path, page_location)
    SELECT u.page_path, u.page_location
    FROM tmp_unk_paths u
    WHERE public.page_path_matches_vdp_logic(u.page_path, v_logic);

    UPDATE public.smart_final_data f
    SET
      vdp_conditions = TRUE,
      inv_url = COALESCE(
        NULLIF(btrim(f.inv_url), ''),
        NULLIF(btrim(f.page_location), ''),
        CASE
          WHEN v_site IS NOT NULL THEN
            rtrim(v_site, '/') || CASE
              WHEN left(f.page_path, 1) = '/' THEN f.page_path
              ELSE '/' || f.page_path
            END
          ELSE f.page_path
        END
      ),
      inv_condition = CASE
        WHEN NULLIF(btrim(f.inv_condition), '') IS NULL
          OR lower(btrim(f.inv_condition)) IN ('unknown', 'other')
        THEN
          CASE
            WHEN f.page_path ~* '/(new)(/|$)' THEN 'New'
            WHEN f.page_path ~* '/(used|pre-owned|preowned)(/|$)' THEN 'Used'
            WHEN f.page_path ~* '/new-(19|20)[0-9]{2}-' THEN 'New'
            WHEN f.page_path ~* '/(used|pre-owned|preowned)-(19|20)[0-9]{2}-' THEN 'Used'
            ELSE f.inv_condition
          END
        ELSE f.inv_condition
      END,
      inv_year = CASE
        WHEN NULLIF(btrim(f.inv_year), '') IS NULL OR btrim(f.inv_year) = '0'
        THEN COALESCE(
          (regexp_match(f.page_path, '(?:^|/)((?:19|20)[0-9]{2})(?:-|/)'))[1],
          (regexp_match(f.page_path, '(?i)/(?:new|used|pre-owned|preowned)-((?:19|20)[0-9]{2})-'))[1],
          f.inv_year
        )
        ELSE f.inv_year
      END
    WHERE f.client_id = v_id
      AND f.report_date BETWEEN p_from AND p_to
      AND f.page_path IN (SELECT page_path FROM tmp_matched);

    GET DIAGNOSTICS v_matched = ROW_COUNT;

    IF v_cms IS NOT NULL THEN
      UPDATE public.smart_final_data f
      SET inv_make = best.make
      FROM (
        SELECT DISTINCT ON (mth.page_path)
          mth.page_path,
          mk.make
        FROM tmp_matched mth
        JOIN public.smart_make mk
          ON lower(mk.cms) = lower(v_cms)
        WHERE public.logic2_slugify(mk.make) IS NOT NULL
          AND position(
            '-' || public.logic2_slugify(mk.make) || '-'
            IN '-' || COALESCE(public.logic2_slugify(mth.page_path), '') || '-'
          ) > 0
        ORDER BY mth.page_path, length(public.logic2_slugify(mk.make)) DESC
      ) best
      WHERE f.client_id = v_id
        AND f.report_date BETWEEN p_from AND p_to
        AND f.page_path = best.page_path
        AND (
          NULLIF(btrim(f.inv_make), '') IS NULL
          OR lower(btrim(f.inv_make)) IN ('unknown', 'other')
        );
      GET DIAGNOSTICS v_filled_make = ROW_COUNT;

      UPDATE public.smart_final_data f
      SET inv_model = best.model
      FROM (
        SELECT DISTINCT ON (mth.page_path)
          mth.page_path,
          md.model
        FROM tmp_matched mth
        JOIN public.smart_models md
          ON lower(md.cms) = lower(v_cms)
        WHERE public.logic2_slugify(md.model) IS NOT NULL
          AND length(public.logic2_slugify(md.model)) >= 3
          AND position(
            '-' || public.logic2_slugify(md.model) || '-'
            IN '-' || COALESCE(public.logic2_slugify(mth.page_path), '') || '-'
          ) > 0
        ORDER BY mth.page_path, length(public.logic2_slugify(md.model)) DESC
      ) best
      WHERE f.client_id = v_id
        AND f.report_date BETWEEN p_from AND p_to
        AND f.page_path = best.page_path
        AND NULLIF(btrim(f.inv_model), '') IS NULL;
      GET DIAGNOSTICS v_filled_model = ROW_COUNT;
    END IF;

    -- Filler rows are labelled by CMS or by dealer group (e.g. 'McKibben' covers
    -- every McKibben store whose CMS is 'MNG Pro Tech').
    CREATE TEMP TABLE tmp_fillers ON COMMIT DROP AS
    SELECT
      public.logic2_clean_make(c.make) AS make,
      public.logic2_clean_make(c.model) AS model,
      NULLIF(btrim(c.type), '') AS type,
      public.logic2_slugify(public.logic2_clean_make(c.make)) AS make_slug,
      public.logic2_slugify(c.model) AS model_slug,
      (v_cms IS NOT NULL AND lower(btrim(c.cms)) = lower(v_cms)) AS exact_cms
    FROM public.smart_custom_unknown_fillers c
    WHERE NULLIF(btrim(c.cms), '') IS NOT NULL
      AND public.logic2_slugify(public.logic2_clean_make(c.make)) IS NOT NULL
      AND (
        (v_cms IS NOT NULL AND lower(btrim(c.cms)) = lower(v_cms))
        OR (
          length(btrim(c.cms)) >= 4
          AND v_name IS NOT NULL
          AND position(lower(btrim(c.cms)) IN lower(v_name)) > 0
        )
      );

    -- Inventory says 'Forest River RV' where the URL only says 'forest-river'.
    INSERT INTO tmp_fillers (make, model, type, make_slug, model_slug, exact_cms)
    SELECT make, model, type, regexp_replace(make_slug, '-(rv|rvs)$', ''), model_slug, exact_cms
    FROM tmp_fillers
    WHERE make_slug ~ '.-(rv|rvs)$';

    CREATE TEMP TABLE tmp_matched_slug ON COMMIT DROP AS
    SELECT
      m.page_path,
      '-' || COALESCE(public.logic2_slugify(public.logic2_clean_make(m.page_path)), '') || '-' AS slug
    FROM tmp_matched m;

    -- The make sits right after the year in a VDP slug, so the earliest hit wins;
    -- longest-first would pick a model name like 'Sportsman' over 'Polaris'.
    UPDATE public.smart_final_data f
    SET inv_make = best.make
    FROM (
      SELECT DISTINCT ON (mth.page_path)
        mth.page_path,
        fl.make
      FROM tmp_matched_slug mth
      JOIN tmp_fillers fl
        ON position('-' || fl.make_slug || '-' IN mth.slug) > 0
      ORDER BY
        mth.page_path,
        position('-' || fl.make_slug || '-' IN mth.slug),
        length(fl.make_slug) DESC,
        fl.exact_cms DESC
    ) best
    WHERE f.client_id = v_id
      AND f.report_date BETWEEN p_from AND p_to
      AND f.page_path = best.page_path
      AND (
        NULLIF(btrim(f.inv_make), '') IS NULL
        OR lower(btrim(f.inv_make)) IN ('unknown', 'other')
      );
    GET DIAGNOSTICS v_filled_filler_make = ROW_COUNT;
    v_filled_make := v_filled_make + v_filled_filler_make;

    UPDATE public.smart_final_data f
    SET
      inv_model = COALESCE(NULLIF(btrim(f.inv_model), ''), best.model),
      inv_type = CASE
        WHEN NULLIF(btrim(f.inv_type), '') IS NULL
          OR lower(btrim(f.inv_type)) IN ('unknown', 'other')
        THEN COALESCE(best.type, f.inv_type)
        ELSE f.inv_type
      END,
      inv_custom_type = COALESCE(NULLIF(btrim(f.inv_custom_type), ''), best.type)
    FROM (
      SELECT DISTINCT ON (mth.page_path, fl.make)
        mth.page_path,
        fl.make,
        fl.model,
        fl.type
      FROM tmp_matched_slug mth
      JOIN tmp_fillers fl
        ON fl.model_slug IS NOT NULL
       AND length(fl.model_slug) >= 2
       AND position('-' || fl.make_slug || '-' || fl.model_slug || '-' IN mth.slug) > 0
      ORDER BY mth.page_path, fl.make, length(fl.model_slug) DESC, fl.exact_cms DESC
    ) best
    WHERE f.client_id = v_id
      AND f.report_date BETWEEN p_from AND p_to
      AND f.page_path = best.page_path
      AND lower(btrim(f.inv_make)) = lower(best.make)
      AND (
        NULLIF(btrim(f.inv_model), '') IS NULL
        OR NULLIF(btrim(f.inv_type), '') IS NULL
        OR lower(btrim(f.inv_type)) IN ('unknown', 'other')
      );
    GET DIAGNOSTICS v_filled_type = ROW_COUNT;

    UPDATE public.smart_final_data f
    SET
      inv_type = c.type,
      inv_custom_type = COALESCE(NULLIF(btrim(f.inv_custom_type), ''), c.type)
    FROM tmp_fillers c
    WHERE f.client_id = v_id
      AND f.report_date BETWEEN p_from AND p_to
      AND f.page_path IN (SELECT page_path FROM tmp_matched)
      AND c.type IS NOT NULL
      AND lower(btrim(f.inv_make)) = lower(c.make)
      AND (
        lower(btrim(COALESCE(f.inv_model, ''))) = lower(c.model)
        OR lower(btrim(COALESCE(f.inv_model, ''))) LIKE lower(c.model) || ' %'
      )
      AND (
        NULLIF(btrim(f.inv_type), '') IS NULL
        OR lower(btrim(f.inv_type)) IN ('unknown', 'other')
      );
    GET DIAGNOSTICS v_filled_filler_type = ROW_COUNT;
    v_filled_type := v_filled_type + v_filled_filler_type;

    -- Fillers spell makes loosely ('Honda' vs 'Honda®'); use the dealer's own
    -- inventory spelling so one make never splits into two on the dashboard.
    UPDATE public.smart_final_data f
    SET inv_make = canon.make
    FROM (
      SELECT DISTINCT ON (s.slug) s.slug, s.make
      FROM (
        SELECT
          public.logic2_slugify(public.logic2_clean_make(i.inv_make)) AS slug,
          btrim(i.inv_make) AS make,
          SUM(COALESCE(i.views, 0)) AS v
        FROM public.smart_final_data i
        WHERE i.client_id = v_id
          AND i.report_date BETWEEN p_from AND p_to
          AND i.inv_sk IS NOT NULL
          AND NULLIF(btrim(i.inv_make), '') IS NOT NULL
        GROUP BY 1, 2
      ) s
      WHERE s.slug IS NOT NULL
      ORDER BY s.slug, s.v DESC
    ) canon
    WHERE f.client_id = v_id
      AND f.report_date BETWEEN p_from AND p_to
      AND f.page_path IN (SELECT page_path FROM tmp_matched)
      AND public.logic2_slugify(public.logic2_clean_make(f.inv_make)) = canon.slug
      AND f.inv_make IS DISTINCT FROM canon.make;

    -- Record what was just fixed, keyed by URL rather than date, so tomorrow's
    -- Step 3 rebuild can be replayed instead of re-derived from scratch. This is
    -- the only durable trace of which URL was ever repaired.
    INSERT INTO public.smart_unknown_vdp_links (
      client_id, ga4_property_id, account_name, report_date,
      page_path, page_location, page_title, views, cms,
      status, matched_vdp_logic, fix_source,
      inv_url, inv_condition, inv_year, inv_make, inv_model,
      inv_type, inv_custom_type, inv_stock_number,
      updated_at
    )
    SELECT DISTINCT ON (f.page_path)
      v_id,
      f.ga4_property_id,
      COALESCE(v_name, f.account_name),
      f.report_date,          -- most recent date seen; metadata only
      f.page_path,
      f.page_location,
      f.page_title,
      f.views,                -- snapshot for context; never replayed back
      v_cms,
      'matched',
      v_logic,
      'logic2',
      f.inv_url,
      f.inv_condition,
      NULLIF(btrim(COALESCE(f.inv_year, '')), '0'),
      f.inv_make,
      f.inv_model,
      f.inv_type,
      f.inv_custom_type,
      f.inv_stock_number,
      now()
    FROM public.smart_final_data f
    JOIN tmp_matched m ON m.page_path = f.page_path
    WHERE f.client_id = v_id
      AND f.report_date BETWEEN p_from AND p_to
      -- The replay keys off inv_url, so an entry without one is not replayable.
      AND NULLIF(btrim(f.inv_url), '') IS NOT NULL
      AND NULLIF(btrim(f.inv_make), '') IS NOT NULL
      AND lower(btrim(f.inv_make)) NOT IN ('unknown', 'other')
    ORDER BY f.page_path, f.report_date DESC
    ON CONFLICT (client_id, page_path) DO UPDATE SET
      account_name = COALESCE(
        EXCLUDED.account_name, public.smart_unknown_vdp_links.account_name),
      report_date = GREATEST(
        EXCLUDED.report_date, public.smart_unknown_vdp_links.report_date),
      page_location = COALESCE(
        EXCLUDED.page_location, public.smart_unknown_vdp_links.page_location),
      page_title = COALESCE(
        EXCLUDED.page_title, public.smart_unknown_vdp_links.page_title),
      views = EXCLUDED.views,
      cms = COALESCE(EXCLUDED.cms, public.smart_unknown_vdp_links.cms),
      -- 'applied' means the replay has already used this entry; never downgrade it.
      status = CASE
        WHEN public.smart_unknown_vdp_links.status = 'applied' THEN 'applied'
        ELSE 'matched'
      END,
      matched_vdp_logic = COALESCE(
        EXCLUDED.matched_vdp_logic, public.smart_unknown_vdp_links.matched_vdp_logic),
      -- A value already in the notebook is the durable record: keep it and only
      -- fill gaps, so a stored fix never flip-flops between daily runs.
      inv_url = COALESCE(public.smart_unknown_vdp_links.inv_url, EXCLUDED.inv_url),
      inv_condition = COALESCE(
        public.smart_unknown_vdp_links.inv_condition, EXCLUDED.inv_condition),
      inv_year = COALESCE(public.smart_unknown_vdp_links.inv_year, EXCLUDED.inv_year),
      inv_make = COALESCE(public.smart_unknown_vdp_links.inv_make, EXCLUDED.inv_make),
      inv_model = COALESCE(public.smart_unknown_vdp_links.inv_model, EXCLUDED.inv_model),
      inv_type = COALESCE(public.smart_unknown_vdp_links.inv_type, EXCLUDED.inv_type),
      inv_custom_type = COALESCE(
        public.smart_unknown_vdp_links.inv_custom_type, EXCLUDED.inv_custom_type),
      inv_stock_number = COALESCE(
        public.smart_unknown_vdp_links.inv_stock_number, EXCLUDED.inv_stock_number),
      updated_at = now()
    -- Hand-corrected rows are off limits to automation. COALESCE because fix_source
    -- is nullable, and a NULL predicate would silently skip the row.
    WHERE COALESCE(public.smart_unknown_vdp_links.fix_source, '') <> 'manual';

    GET DIAGNOSTICS v_noted = ROW_COUNT;
  END IF;

  INSERT INTO public.smart_exception_data (
    customer_id, urls, cms, dealer_name, page_path, views, last_seen, updated_at
  )
  SELECT
    v_id,
    COALESCE(
      NULLIF(btrim(u.page_location), ''),
      CASE
        WHEN v_site IS NOT NULL THEN
          rtrim(v_site, '/') || CASE
            WHEN left(u.page_path, 1) = '/' THEN u.page_path
            ELSE '/' || u.page_path
          END
        ELSE u.page_path
      END
    ),
    v_cms,
    COALESCE(v_name, v_id),
    u.page_path,
    u.views,
    CURRENT_DATE,
    now()
  FROM tmp_unk_paths u
  WHERE NOT EXISTS (
    SELECT 1 FROM tmp_matched m WHERE m.page_path = u.page_path
  )
  ON CONFLICT (customer_id, page_path)
  DO UPDATE SET
    urls = EXCLUDED.urls,
    cms = COALESCE(EXCLUDED.cms, public.smart_exception_data.cms),
    dealer_name = COALESCE(EXCLUDED.dealer_name, public.smart_exception_data.dealer_name),
    views = EXCLUDED.views,
    last_seen = EXCLUDED.last_seen,
    updated_at = now();

  GET DIAGNOSTICS v_exceptions = ROW_COUNT;

  DELETE FROM public.smart_exception_data e
  WHERE e.customer_id = v_id
    AND (
      e.page_path IN (SELECT page_path FROM tmp_matched)
      OR NOT EXISTS (
        SELECT 1 FROM tmp_unk_paths u WHERE u.page_path = e.page_path
      )
    );
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'client_id', v_id,
    'dealer_name', v_name,
    'cms', v_cms,
    'has_logic2', v_logic IS NOT NULL,
    'unknown_paths', (SELECT COUNT(*) FROM tmp_unk_paths),
    'mapped_rows', v_matched,
    'filled_make_rows', v_filled_make,
    'filled_model_rows', v_filled_model,
    'filled_filler_make_rows', v_filled_filler_make,
    'filled_type_rows', v_filled_type,
    'notebook_entries_written', v_noted,
    'exception_paths', v_exceptions,
    'cleared_exceptions', v_cleared
  );
END;
$$;

COMMENT ON FUNCTION public.apply_logic2_unknown_cleanup(text, date, date) IS
  'Standalone Unknown/Other cleanup: map matching smart_vdp_logic_2 paths on smart_final_data, record each fix in the smart_unknown_vdp_links notebook, and skip URLs already recorded there. Leftover URLs go to smart_exception_data.';

REVOKE ALL ON FUNCTION public.apply_logic2_unknown_cleanup(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_logic2_unknown_cleanup(text, date, date)
  TO service_role;

REVOKE ALL ON FUNCTION public.logic2_slugify(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.logic2_slugify(text) TO service_role;

REVOKE ALL ON FUNCTION public.logic2_clean_make(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.logic2_clean_make(text) TO service_role;

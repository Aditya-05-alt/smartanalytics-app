-- SouthWest Nissan (1992343311): DealerOn /viewdetails/{new|used|cpo}/{vin}/{slug} URLs.
-- The site shows CPO units under /cpo/ while Hoot stores them under /used/, and the slug
-- changes over time, so path matching misses them. extract_vin_from_text only reads a VIN
-- at the end of the path, so add a mid-path VIN for this dealer only before the by_vin join.

DO $patch$
DECLARE
  d text;
  anchor text := 'public.extract_vin_from_text(g.page_path) AS path_vin';
  repl text := $r$COALESCE(
        public.extract_vin_from_text(g.page_path),
        CASE WHEN g.client_id = '1992343311'
             THEN upper((regexp_match(g.page_path, '^/viewdetails/(?:new|used|cpo)/([A-Za-z0-9]{17})/', 'i'))[1])
        END
      ) AS path_vin$r$;
BEGIN
  d := pg_get_functiondef('public.build_smart_final_data(text,integer,date,date)'::regprocedure);
  IF position('1992343311' in d) > 0 THEN
    RETURN;
  END IF;
  IF (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'build_smart_final_data: path_vin anchor not found exactly once';
  END IF;
  EXECUTE replace(d, anchor, repl);
END
$patch$;

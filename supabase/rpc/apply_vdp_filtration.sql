-- Fix PostgREST "Could not choose the best candidate function" for apply_vdp_filtration.
-- Run in Supabase SQL editor AFTER your 2-arg function is deployed.
--
-- Keep: apply_vdp_filtration(p_client_id text, p_days_back integer)
-- Drop: apply_vdp_filtration(p_client_id text)  — legacy 1-arg overload

DROP FUNCTION IF EXISTS public.apply_vdp_filtration(text);

-- Optional: verify the remaining signature
-- SELECT proname, pg_get_function_arguments(oid)
-- FROM pg_proc
-- WHERE proname = 'apply_vdp_filtration';

GRANT EXECUTE ON FUNCTION public.apply_vdp_filtration(text, integer)
  TO anon, authenticated, service_role;

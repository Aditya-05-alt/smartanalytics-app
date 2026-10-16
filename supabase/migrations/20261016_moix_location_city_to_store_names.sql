-- Moix RV (488499138): Hoot switched from city labels to store names in Apr 2026.
-- Align historical Final rows so location filters work for YoY.

UPDATE public.smart_final_data
SET inv_location = CASE trim(inv_location)
  WHEN 'Springdale, AR' THEN 'McGaugh Outpost Springdale'
  WHEN 'Hot Springs, AR' THEN 'Hot Springs Landing'
  WHEN 'Conway, AR' THEN 'Moix RV Supercenter'
  WHEN 'Jonesboro, AR' THEN 'Moix RV Mashburn Ridge Jonesboro'
  ELSE inv_location
END
WHERE client_id = '488499138'
  AND report_date < '2026-04-01'
  AND trim(inv_location) IN (
    'Springdale, AR',
    'Hot Springs, AR',
    'Conway, AR',
    'Jonesboro, AR'
  );

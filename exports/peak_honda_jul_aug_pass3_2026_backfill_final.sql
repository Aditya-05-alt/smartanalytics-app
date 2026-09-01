-- Peak Honda Jul–Aug 2026 unknown URL backfill (one-time)
-- client_id=2721177227, report_date 2026-07-01..2026-08-31
-- Only rows with blank inv_url and vdp_conditions not true; regex-matching paths only.

UPDATE public.smart_final_data AS f
SET
  inv_condition = p.condition,
  inv_year = p.year,
  inv_make = p.make,
  inv_model = NULLIF(p.model, ''),
  inv_type = NULLIF(p.type, ''),
  inv_stock_number = NULLIF(p.stock, ''),
  inv_url = COALESCE(
    NULLIF(TRIM(f.inv_url), ''),
    NULLIF(TRIM(f.page_location), ''),
    f.page_path
  ),
  vdp_conditions = true
FROM (
  VALUES
  ('/inventory/new/2025-honda-crf300las-motorcycle-s5402717', 'New', '2025', 'Honda', 'crf300las', 'Motorcycle', 's5402717'),
  ('/inventory/new/2025-honda-pioneer-1000-6-deluxe-crew-utv-s4201805', 'New', '2025', 'Honda', 'pioneer-1000-6-deluxe-crew', 'Utv', 's4201805'),
  ('/inventory/new/2025-honda-pioneer-1000-deluxe-utv-s4902340', 'New', '2025', 'Honda', 'pioneer-1000-deluxe', 'Utv', 's4902340'),
  ('/inventory/new/2025-vm-pro-pontoon-trlr-s1013602', 'New', '2025', 'VM', 'pro', 'Boat Trailer', 's1013602'),
  ('/inventory/new/2026-honda-africa-twin-adventure-sports-motorcycle-tk200569', 'New', '2026', 'Honda', 'africa-twin-adventure-sports', 'Motorcycle', 'tk200569'),
  ('/inventory/new/2026-honda-cb650ract-motorcycle-t5201036', 'New', '2026', 'Honda', 'cb650ract', 'Motorcycle', 't5201036'),
  ('/inventory/new/2026-honda-cbr10rat-motorcycle-tk900357', 'New', '2026', 'Honda', 'cbr10rat', 'Motorcycle', 'tk900357'),
  ('/inventory/new/2026-honda-cbr600rat-motorcycle-tk100429', 'New', '2026', 'Honda', 'cbr600rat', 'Motorcycle', 'tk100429'),
  ('/inventory/new/2026-honda-cbr650r-motorcycle-t5201964', 'New', '2026', 'Honda', 'cbr650r', 'Motorcycle', 't5201964'),
  ('/inventory/new/2026-honda-cbr650ract-motorcycle-t5202482', 'New', '2026', 'Honda', 'cbr650ract', 'Motorcycle', 't5202482'),
  ('/inventory/new/2026-honda-cbr650ract-motorcycle-t5202506', 'New', '2026', 'Honda', 'cbr650ract', 'Motorcycle', 't5202506'),
  ('/inventory/new/2026-honda-cbr650ract-motorcycle-t5202520', 'New', '2026', 'Honda', 'cbr650ract', 'Motorcycle', 't5202520'),
  ('/inventory/new/2026-honda-cbr650ract-motorcycle-t5202532', 'New', '2026', 'Honda', 'cbr650ract', 'Motorcycle', 't5202532'),
  ('/inventory/new/2026-honda-cbr650ract-motorcycle-t5202533', 'New', '2026', 'Honda', 'cbr650ract', 'Motorcycle', 't5202533'),
  ('/inventory/new/2026-honda-cmx1100dt-motorcycle-tk100960', 'New', '2026', 'Honda', 'cmx1100dt', 'Motorcycle', 'tk100960'),
  ('/inventory/new/2026-honda-cmx1100t-tk100594', 'New', '2026', 'Honda', 'cmx1100t', NULL, 'tk100594'),
  ('/inventory/new/2026-honda-cmx1100t-tk100744', 'New', '2026', 'Honda', 'cmx1100t', NULL, 'tk100744'),
  ('/inventory/new/2026-honda-cmx500a2t-t5900694', 'New', '2026', 'Honda', 'cmx500a2t', NULL, 't5900694'),
  ('/inventory/new/2026-honda-crf1100l4t-motorcycle-tk200300', 'New', '2026', 'Honda', 'crf1100l4t', 'Motorcycle', 'tk200300'),
  ('/inventory/new/2026-honda-crf1100ldt-motorcycle-tk200147', 'New', '2026', 'Honda', 'crf1100ldt', 'Motorcycle', 'tk200147'),
  ('/inventory/new/2026-honda-crf1100ldt-motorcycle-tk200186', 'New', '2026', 'Honda', 'crf1100ldt', 'Motorcycle', 'tk200186'),
  ('/inventory/new/2026-honda-crf1100lt-motorcycle-tk200335', 'New', '2026', 'Honda', 'crf1100lt', 'Motorcycle', 'tk200335'),
  ('/inventory/new/2026-honda-crf1100lt-motorcycle-tk200363', 'New', '2026', 'Honda', 'crf1100lt', 'Motorcycle', 'tk200363'),
  ('/inventory/new/2026-honda-crf150rbt-tk800589', 'New', '2026', 'Honda', 'crf150rbt', NULL, 'tk800589'),
  ('/inventory/new/2026-honda-crf150rt-motorcycle-tk800237', 'New', '2026', 'Honda', 'crf150rt', 'Motorcycle', 'tk800237'),
  ('/inventory/new/2026-honda-crf250r-motorcycle-tk802470', 'New', '2026', 'Honda', 'crf250r', 'Motorcycle', 'tk802470'),
  ('/inventory/new/2026-honda-crf250rt-motorcycle-tk800647', 'New', '2026', 'Honda', 'crf250rt', 'Motorcycle', 'tk800647'),
  ('/inventory/new/2026-honda-crf300l-rally-motorcycle-t5500585', 'New', '2026', 'Honda', 'crf300l-rally', 'Motorcycle', 't5500585'),
  ('/inventory/new/2026-honda-crf450rt-tk901547', 'New', '2026', 'Honda', 'crf450rt', NULL, 'tk901547'),
  ('/inventory/new/2026-honda-crf450x-motorcycle-tk700265', 'New', '2026', 'Honda', 'crf450x', 'Motorcycle', 'tk700265'),
  ('/inventory/new/2026-honda-crf450x-motorcycle-tk700270', 'New', '2026', 'Honda', 'crf450x', 'Motorcycle', 'tk700270'),
  ('/inventory/new/2026-honda-fourtrax-rancher-4x4-trx420fm1t-atv-tj203319', 'New', '2026', 'Honda', 'fourtrax-rancher-4x4-trx420fm1t', 'Atv', 'tj203319'),
  ('/inventory/new/2026-honda-gl1800bdt-tk800129', 'New', '2026', 'Honda', 'gl1800bdt', NULL, 'tk800129'),
  ('/inventory/new/2026-honda-gl1800dt-motorcycle-tk800791', 'New', '2026', 'Honda', 'gl1800dt', 'Motorcycle', 'tk800791'),
  ('/inventory/new/2026-honda-gl1800dt-motorcycle-tk800865', 'New', '2026', 'Honda', 'gl1800dt', 'Motorcycle', 'tk800865'),
  ('/inventory/new/2026-honda-gold-wing-tour-airbag-dct-gl1800tdaset-motorcycle-tk800047', 'New', '2026', 'Honda', 'gold-wing-tour-airbag-dct-gl1800tdaset', 'Motorcycle', 'tk800047'),
  ('/inventory/new/2026-honda-nt1100dt-motorcycle-tk100654', 'New', '2026', 'Honda', 'nt1100dt', 'Motorcycle', 'tk100654'),
  ('/inventory/new/2026-honda-pioneer-700-2-sxs700m2t-utv-t4100056', 'New', '2026', 'Honda', 'pioneer-700-2-sxs700m2t', 'Utv', 't4100056'),
  ('/inventory/new/2026-honda-pioneer-700-deluxe-sxs700m2dt-utv-t4101213', 'New', '2026', 'Honda', 'pioneer-700-deluxe-sxs700m2dt', 'Utv', 't4101213'),
  ('/inventory/new/2026-honda-sxs10s2rdt-t4700046-r', 'New', '2026', 'Honda', 'sxs10s2rdt-t4700046', NULL, 'r'),
  ('/inventory/new/2026-honda-sxs10s2rdt-t4700180', 'New', '2026', 'Honda', 'sxs10s2rdt', NULL, 't4700180'),
  ('/inventory/new/2026-honda-sxs10s2xdt-t4700046-x', 'New', '2026', 'Honda', 'sxs10s2xdt-t4700046', NULL, 'x'),
  ('/inventory/new/2026-honda-sxs10s2xdt-t4700146', 'New', '2026', 'Honda', 'sxs10s2xdt', NULL, 't4700146'),
  ('/inventory/new/2026-honda-sxs10s4xdt-t4600267', 'New', '2026', 'Honda', 'sxs10s4xdt', NULL, 't4600267'),
  ('/inventory/new/2026-honda-sxs10s4xt-t4600048', 'New', '2026', 'Honda', 'sxs10s4xt', NULL, 't4600048'),
  ('/inventory/new/2026-honda-sxs700m2ft-t4100543', 'New', '2026', 'Honda', 'sxs700m2ft', NULL, 't4100543'),
  ('/inventory/new/2026-honda-sxs700m4dt-t4102133', 'New', '2026', 'Honda', 'sxs700m4dt', NULL, 't4102133'),
  ('/inventory/new/2026-honda-trx520fm1t-tj200419', 'New', '2026', 'Honda', 'trx520fm1t', NULL, 'tj200419'),
  ('/inventory/new/2026-honda-trx520fm1t-tj201743', 'New', '2026', 'Honda', 'trx520fm1t', NULL, 'tj201743'),
  ('/inventory/new/2026-honda-trx520fm6t-tj200674', 'New', '2026', 'Honda', 'trx520fm6t', NULL, 'tj200674'),
  ('/inventory/new/2026-honda-trx520fm6t-tj201025', 'New', '2026', 'Honda', 'trx520fm6t', NULL, 'tj201025'),
  ('/inventory/new/2026-honda-trx700fat-tj200127', 'New', '2026', 'Honda', 'trx700fat', NULL, 'tj200127'),
  ('/inventory/new/2027-honda-crf250rv-dirt-bike-vk900620', 'New', '2027', 'Honda', 'crf250rv', 'Dirt Bike', 'vk900620'),
  ('/inventory/new/2027-honda-trx420fa2v-motorcycle-vj300474', 'New', '2027', 'Honda', 'trx420fa2v', 'Motorcycle', 'vj300474'),
  ('/inventory/used/2004-honda-gl18at4-motorcycle-4a300521', 'Used', '2004', 'Honda', 'gl18at4', 'Motorcycle', '4a300521'),
  ('/inventory/used/2009-bmw-g-650-gs-motorcycle-9zw16799', 'Used', '2009', 'BMW', 'g-650-gs', 'Motorcycle', '9zw16799'),
  ('/inventory/used/2013-harley-davidson-fltrxse-motorcycle-db962090', 'Used', '2013', 'Harley-Davidson', 'fltrxse', 'Motorcycle', 'db962090'),
  ('/inventory/used/2019-harley-davidson-softail-slim-motorcycle-kb059704', 'Used', '2019', 'Harley-Davidson', 'softail-slim', 'Motorcycle', 'kb059704'),
  ('/inventory/used/2022-harley-davidson-flhxs-street-glide-special-motorcycle-nb628535', 'Used', '2022', 'Harley-Davidson', 'flhxs-street-glide-special', 'Motorcycle', 'nb628535'),
  ('/inventory/used/2022-honda-rebel-300-motorcycle-n5500602', 'Used', '2022', 'Honda', 'rebel-300', 'Motorcycle', 'n5500602'),
  ('/inventory/used/2023-honda-rebel-500-motorcycle-p5600035', 'Used', '2023', 'Honda', 'rebel-500', 'Motorcycle', 'p5600035'),
  ('/inventory/used/2025-suzuki-gsx-r600-motorcycle-s7101139', 'Used', '2025', 'Suzuki', 'gsx-r600', 'Motorcycle', 's7101139'),
  ('/inventory/used/2025-yamaha-yz450f-dirt-bike-sa015815', 'Used', '2025', 'Yamaha', 'yz450f', 'Dirt Bike', 'sa015815'),
  ('/inventory/used/2026-honda-nt1100-motorcycle-tk100125', 'Used', '2026', 'Honda', 'nt1100', 'Motorcycle', 'tk100125')
) AS p(page_path, condition, year, make, model, type, stock)
WHERE f.client_id = '2721177227'
  AND f.report_date BETWEEN '2026-07-01' AND '2026-08-31'
  AND f.page_path = p.page_path
  AND (f.inv_url IS NULL OR btrim(f.inv_url) = '')
  AND COALESCE(f.vdp_conditions, false) IS NOT TRUE;

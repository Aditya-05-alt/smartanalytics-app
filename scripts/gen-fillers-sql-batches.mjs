import fs from 'fs';

const rows = JSON.parse(
  fs.readFileSync('exports/interact_rv_make_model_type_2026.json', 'utf8'),
);
const esc = (s) => String(s).replace(/'/g, "''");
const cms = 'Interact RV';
const batchSize = 100;
const dir = 'exports/sql_batches_fillers';
fs.mkdirSync(dir, { recursive: true });

const files = [];
for (let i = 0; i < rows.length; i += batchSize) {
  const chunk = rows.slice(i, i + batchSize);
  const values = chunk
    .map(
      (r) =>
        `('${cms}', '${esc(r.make)}', '${esc(r.model)}', '${esc(r.type)}')`,
    )
    .join(',\n');
  const sql = `INSERT INTO public.smart_custom_unknown_fillers (cms, make, model, type)
VALUES
${values}
ON CONFLICT (cms, make, model, type) DO UPDATE SET
  updated_at = now();`;
  const name = `${dir}/batch_${String(Math.floor(i / batchSize) + 1).padStart(2, '0')}.sql`;
  fs.writeFileSync(name, sql);
  files.push(name);
}

console.log(JSON.stringify({ total: rows.length, batches: files.length }, null, 2));

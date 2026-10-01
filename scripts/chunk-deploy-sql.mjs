/**
 * Deploy large SQL via chunked inserts + EXECUTE (for environments without DB URL).
 * Usage: node scripts/chunk-deploy-sql.mjs path/to/file.sql
 *
 * Prints SQL statements that can be run via Supabase execute_sql MCP.
 */
import fs from 'fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/chunk-deploy-sql.mjs <sql-file>');
  process.exit(1);
}

const sql = fs.readFileSync(file, 'utf8');
const CHUNK = 3500;
const chunks = [];
for (let i = 0; i < sql.length; i += CHUNK) {
  chunks.push(sql.slice(i, i + CHUNK));
}

const out = [];
out.push(`CREATE TABLE IF NOT EXISTS public._tmp_sql_deploy (ord int PRIMARY KEY, chunk text);`);
out.push(`TRUNCATE public._tmp_sql_deploy;`);
chunks.forEach((chunk, i) => {
  const escaped = chunk.replace(/'/g, "''");
  out.push(
    `INSERT INTO public._tmp_sql_deploy(ord, chunk) VALUES (${i}, '${escaped}');`
  );
});
out.push(`DO $deploy$
DECLARE
  v_sql text;
BEGIN
  SELECT string_agg(chunk, '' ORDER BY ord) INTO v_sql FROM public._tmp_sql_deploy;
  EXECUTE v_sql;
END;
$deploy$;`);
out.push(`DROP TABLE public._tmp_sql_deploy;`);

fs.mkdirSync('tmp-sql-chunks', { recursive: true });
out.forEach((stmt, i) => {
  fs.writeFileSync(`tmp-sql-chunks/${String(i).padStart(3, '0')}.sql`, stmt);
});
console.log(`Wrote ${out.length} statements for ${chunks.length} chunks (${sql.length} chars)`);

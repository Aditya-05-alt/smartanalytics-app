import fs from 'fs';

const src =
  'C:/Users/adity/.cursor/projects/c-htmls-Smart-analytics-Main-smartanalytics-app/agent-tools/9544194a-19a2-4085-8a74-6748a25e545a.txt';
const raw = fs.readFileSync(src, 'utf8');

let text = raw;
if (text.includes('\\"')) {
  // MCP wrapper escaped the JSON payload as a string body
  const startEsc = text.indexOf('[{\\"make\\"');
  if (startEsc >= 0) {
    const endEsc = text.lastIndexOf('}]');
    text = text.slice(startEsc, endEsc + 2).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
}
const marker = text.indexOf('[{"make"');
if (marker < 0) throw new Error('array start not found');
const end = text.lastIndexOf('}]');
if (end < 0) throw new Error('array end not found');
const arr = JSON.parse(text.slice(marker, end + 2));

fs.mkdirSync('exports', { recursive: true });
const tsv = [
  'make\tmodel\ttype\trows\tviews',
  ...arr.map((r) => [r.make, r.model, r.type, r.rows, r.views].join('\t')),
].join('\n');
fs.writeFileSync('exports/interact_rv_make_model_type_2026.tsv', tsv + '\n');
fs.writeFileSync(
  'exports/interact_rv_make_model_type_2026.json',
  JSON.stringify(arr),
);

const makes = new Set(arr.map((r) => r.make));
const models = new Set(arr.map((r) => r.model));
const types = new Set(arr.map((r) => r.type));
const top = [...arr].sort((a, b) => Number(b.views) - Number(a.views)).slice(0, 30);

console.log(
  JSON.stringify(
    {
      combinations: arr.length,
      makes: makes.size,
      models: models.size,
      types: types.size,
      top30: top,
      forestWolfPup: arr.filter(
        (r) =>
          String(r.make).toLowerCase().includes('forest river') &&
          String(r.model).toLowerCase().includes('cherokee wolf pup'),
      ),
    },
    null,
    2,
  ),
);

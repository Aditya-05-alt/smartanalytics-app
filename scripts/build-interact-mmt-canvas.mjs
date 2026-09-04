import fs from 'fs';
import path from 'path';

const root = path.resolve('exports');
const rows = JSON.parse(
  fs.readFileSync(path.join(root, 'interact_rv_make_model_type_2026.json'), 'utf8'),
);
const sorted = [...rows].sort((a, b) => Number(b.views) - Number(a.views));
const dataLit = JSON.stringify(sorted);

const canvas = `import {
  Card,
  CardBody,
  CardHeader,
  Divider,
  H1,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  TextInput,
  Select,
  useCanvasState,
} from 'cursor/canvas';

type RowT = { make: string; model: string; type: string; rows: number; views: number };

const ALL: RowT[] = ${dataLit};

export default function InteractMakeModelType() {
  const [q, setQ] = useCanvasState('q', '');
  const [type, setType] = useCanvasState('type', 'All');

  const types = ['All', ...Array.from(new Set(ALL.map((r) => r.type))).sort()];
  const filtered = ALL.filter((r) => {
    if (type !== 'All' && r.type !== type) return false;
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return (
      r.make.toLowerCase().includes(s) ||
      r.model.toLowerCase().includes(s) ||
      r.type.toLowerCase().includes(s)
    );
  });

  return (
    <Stack gap={16} style={{ padding: 20 }}>
      <H1>Interact RV — Make · Model · Type</H1>
      <Text tone="secondary">
        Local table (not Supabase) · smart_final_data · Interact RV · 2026 YTD · {ALL.length}{' '}
        combinations
      </Text>
      <Row gap={12}>
        <Stat label="Combinations" value={String(ALL.length)} />
        <Stat label="Makes" value={String(new Set(ALL.map((r) => r.make)).size)} />
        <Stat label="Models" value={String(new Set(ALL.map((r) => r.model)).size)} />
        <Stat label="Types" value={String(new Set(ALL.map((r) => r.type)).size)} />
      </Row>
      <Card>
        <CardHeader>Confirmed example</CardHeader>
        <CardBody>
          <Text>
            Forest River Rv · Cherokee Wolf Pup → Travel Trailer
          </Text>
        </CardBody>
      </Card>
      <Row gap={12} style={{ alignItems: 'end' }}>
        <Stack gap={4} style={{ flex: 1 }}>
          <Text weight="semibold">Search make / model / type</Text>
          <TextInput
            value={q}
            onChange={setQ}
            placeholder="e.g. Wolf Pup, Newmar, Fifth Wheel"
          />
        </Stack>
        <Stack gap={4} style={{ width: 260 }}>
          <Text weight="semibold">Type filter</Text>
          <Select
            value={type}
            onChange={setType}
            options={types.map((t) => ({ label: t, value: t }))}
          />
        </Stack>
      </Row>
      <Text tone="secondary">
        Showing {Math.min(filtered.length, 400)} of {filtered.length} matches (sorted by views)
      </Text>
      <Divider />
      <Table
        headers={['Make', 'Model', 'Type', 'Views']}
        columnAlign={['left', 'left', 'left', 'right']}
        stickyHeader
        striped
        rows={filtered.slice(0, 400).map((r) => [
          r.make,
          r.model,
          r.type,
          Number(r.views).toLocaleString(),
        ])}
      />
      {filtered.length > 400 ? (
        <Text tone="secondary">
          Truncated to 400 rows in the canvas — full list is in
          exports/interact_rv_make_model_type_2026.tsv
        </Text>
      ) : null}
    </Stack>
  );
}
`;

const out =
  'C:/Users/adity/.cursor/projects/c-htmls-Smart-analytics-Main-smartanalytics-app/canvases/interact-rv-make-model-type.canvas.tsx';
fs.writeFileSync(out, canvas);
console.log(JSON.stringify({ out, combinations: sorted.length }, null, 2));

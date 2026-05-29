import { Panel, PanelHeader } from '@/components/dashboard/Panel';
import StatusBar from '@/components/dashboard/StatusBar';
import { PROVIDERS } from '@/lib/data/dealers';

export const metadata = { title: 'Admin · SmartAnalytics' };

const STATUS_STYLE = {
  Active: { background: 'var(--gd)', color: 'var(--green)' },
  Review: { background: 'var(--yd)', color: 'var(--yellow)' },
  Manual: { background: 'var(--s3)', color: 'var(--t3)' },
};

export default function AdminPage() {
  return (
    <>
      <div className="page-tabs">
        <div className="pt active">Client Health</div>
        <div className="pt">Providers</div>
        <div className="pt">Import Log</div>
        <div className="pt-right" />
      </div>

      <div className="content">
        <Panel>
          <PanelHeader title="Provider Templates">
            <button
              type="button"
              style={{
                padding: '5px 12px',
                background: 'var(--acc-soft)',
                border: '1px solid rgba(200,232,122,.3)',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--acc)',
                cursor: 'pointer',
                marginLeft: 'auto',
              }}
            >
              + Add Provider
            </button>
          </PanelHeader>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Categories</th>
                  <th>Cond.</th>
                  <th>Make</th>
                  <th>Year</th>
                  <th>Location</th>
                  <th>Dealers</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {PROVIDERS.map((p) => {
                  const s = STATUS_STYLE[p.status] || STATUS_STYLE.Manual;
                  return (
                    <tr key={p.name}>
                      <td className="tn">{p.name}</td>
                      <td>{p.categories}</td>
                      <td>{p.cond}</td>
                      <td>{p.make}</td>
                      <td>{p.year}</td>
                      <td>{p.loc}</td>
                      <td>{p.dealers}</td>
                      <td>
                        <span className="delta" style={s}>{p.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <StatusBar items={[{ label: '96 healthy · 4 review', color: 'var(--green)' }]} />
    </>
  );
}

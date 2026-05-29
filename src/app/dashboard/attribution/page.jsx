import { Panel, PanelHeader, PanelBody } from '@/components/dashboard/Panel';
import StatusBar from '@/components/dashboard/StatusBar';
import { ATTRIBUTION } from '@/lib/data/channels';

export const metadata = { title: 'Attribution · SmartAnalytics' };

const HEADER_GRID = 'grid grid-cols-[120px_1fr_55px_60px_60px] gap-2';

export default function AttributionPage() {
  return (
    <>
      <div className="page-tabs">
        <div className="pt active">Attribution Overview</div>
        <div className="pt-right" />
      </div>

      <div className="content">
        <Panel>
          <PanelHeader
            title="True Channel Attribution vs GA4 Last-Click — VDP Sessions"
            badge={{ label: 'First-touch model', bg: 'var(--bld)', color: 'var(--blue)' }}
          />
          <PanelBody>
            <div
              className={HEADER_GRID}
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--t3)',
                textTransform: 'uppercase',
                letterSpacing: '.06em',
                padding: '0 0 8px',
                borderBottom: '1px solid var(--bd)',
                marginBottom: 6,
                display: 'grid',
              }}
            >
              <span>Channel</span>
              <span style={{ paddingLeft: 4 }}>GA4 credited → True credit</span>
              <span style={{ textAlign: 'right' }}>GA4 says</span>
              <span style={{ textAlign: 'right' }}>True is</span>
              <span style={{ textAlign: 'right' }}>Hidden</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {ATTRIBUTION.map((r, i) => (
                <div
                  key={r.name}
                  className={HEADER_GRID}
                  style={{
                    display: 'grid',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: i < ATTRIBUTION.length - 1 ? '1px solid var(--bd)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: r.color,
                      }}
                    />
                    <div style={{ fontSize: 12, color: 'var(--t2)' }}>{r.name}</div>
                  </div>

                  <div style={{ position: 'relative', height: 20 }}>
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'var(--s3)',
                        borderRadius: 3,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        height: '100%',
                        width: `${r.ga4Pct}%`,
                        background: r.color,
                        borderRadius: 3,
                        opacity: 0.4,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 8,
                        height: '50%',
                        width: `${r.truePct}%`,
                        background: r.color,
                        borderRadius: 3,
                      }}
                    />
                  </div>

                  <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--t3)' }}>
                    {r.ga4.toLocaleString()}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--t)' }}>
                    {Math.round(r.ga4 * (r.truePct / r.ga4Pct)).toLocaleString()}
                  </div>
                  <div
                    style={{
                      textAlign: 'right',
                      fontSize: 11,
                      fontWeight: 700,
                      color: r.delta >= 0 ? 'var(--green)' : 'var(--red)',
                    }}
                  >
                    {r.delta >= 0 ? '+' : ''}{r.delta}%
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: '1rem',
                padding: '.75rem',
                background: 'rgba(78,224,156,.06)',
                border: '1px solid rgba(78,224,156,.2)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--green)',
              }}
            >
              ✓ True first-touch attribution shows organic and paid are responsible for{' '}
              <strong>89%</strong> of sessions GA4 credits to Direct. Your SEO and PPC ROI is
              significantly understated.
            </div>
          </PanelBody>
        </Panel>
      </div>

      <StatusBar items={[{ label: 'Attribution · 90-day window', color: 'var(--green)' }]} />
    </>
  );
}

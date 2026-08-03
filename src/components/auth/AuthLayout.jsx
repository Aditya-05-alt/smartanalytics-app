import Logo from '@/components/ui/Logo';
import ThemeToggle from '@/components/ui/ThemeToggle';

const STATS = [
  { label: 'VDP Views', value: '48.2K', delta: '+12%', tone: 'up' },
  { label: 'Warm Leads', value: '1,240', delta: '+8%', tone: 'up' },
  { label: 'Local Visitors', value: '63%', delta: '+3pp', tone: 'up' },
];

/** Fixed heights (%) so SSR/client match and the preview looks like a real series. */
const BARS = [42, 55, 48, 68, 61, 74, 58, 82, 70, 88, 76, 92];

const TONE_COLOR = {
  up: 'var(--acc)',
  ne: 'var(--t3)',
  dn: '#f87171',
};

export default function AuthLayout({ children }) {
  return (
    <main className="relative z-10 min-h-screen grid lg:grid-cols-[1.05fr_1fr]">
      {/* ─── LEFT — Branding / Data preview ───────────── */}
      <aside
        className="relative hidden lg:flex flex-col overflow-hidden"
        style={{ background: 'var(--s1)', borderRight: '1px solid var(--bd)' }}
      >
        {/* ambient color washes */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(600px 400px at 15% 10%, rgba(200,232,122,.12), transparent 60%),' +
              'radial-gradient(700px 500px at 85% 90%, rgba(111,160,255,.10), transparent 60%)',
          }}
        />

        {/* top — logo */}
        <div className="relative z-10 p-8">
          <Logo size="lg" />
        </div>

        {/* middle — pitch + chart preview */}
        <div className="relative z-10 flex-1 flex flex-col justify-center px-10 xl:px-16">
          <h1
            className="font-display font-extrabold leading-[1.05] tracking-tight"
            style={{ fontSize: 'clamp(28px, 3vw, 44px)', color: 'var(--t)' }}
          >
            Dealer analytics
            <br />
            that actually <span style={{ color: 'var(--acc)' }}>moves metal.</span>
          </h1>
          <p
            className="mt-4 max-w-md text-[14px] leading-relaxed"
            style={{ color: 'var(--t2)' }}
          >
            Track VDP views, attribution, and warm leads across 100+ rooftops —
            RV, Auto, Powersports & Marine — in a single, fast dashboard.
          </p>

          {/* decorative chart preview (mock data for design only) */}
          <div
            className="mt-10 rounded-[14px] p-5 max-w-md animate-fade-up"
            style={{
              background: 'var(--s2)',
              border: '1px solid var(--bd)',
              boxShadow: '0 20px 60px -28px rgba(0,0,0,.5)',
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
                Daily VDP Views
              </div>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded"
                style={{ background: 'rgba(200,232,122,.15)', color: 'var(--acc)' }}
              >
                +12% MoM
              </span>
            </div>
            <div className="flex items-end gap-1.5 h-24" aria-hidden="true">
              {BARS.map((height, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-[4px]"
                  style={{
                    height: `${height}%`,
                    background: 'var(--acc)',
                    opacity: 0.45 + (height / 100) * 0.55,
                  }}
                />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3 mt-4 pt-4" style={{ borderTop: '1px solid var(--bd)' }}>
              {STATS.map((s) => (
                <div key={s.label}>
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
                    {s.label}
                  </div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="font-display font-bold text-[16px]" style={{ color: 'var(--t)' }}>
                      {s.value}
                    </span>
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: TONE_COLOR[s.tone] || TONE_COLOR.ne }}
                    >
                      {s.delta}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="relative z-10 px-10 xl:px-16 py-6 text-[11px]" style={{ color: 'var(--t3)' }}>
          Trusted by 100+ dealerships · GA4 · Digital Envoy · Provider feeds
        </div>
      </aside>

      {/* ─── RIGHT — Form panel ──────────────────────── */}
      <section className="relative flex flex-col">
        {/* Top row: mobile logo + theme toggle */}
        <div className="flex items-center justify-between px-6 pt-6 lg:px-8">
          <div className="lg:hidden">
            <Logo size="md" />
          </div>
          <div className="lg:ml-auto">
            <ThemeToggle variant="icon" />
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-[440px] animate-fade-up">{children}</div>
        </div>

        <footer
          className="px-6 py-4 text-center text-[11px]"
          style={{ color: 'var(--t3)', borderTop: '1px solid var(--bd)' }}
        >
          © {new Date().getFullYear()} SmartAnalytics · Privacy · Terms
        </footer>
      </section>
    </main>
  );
}

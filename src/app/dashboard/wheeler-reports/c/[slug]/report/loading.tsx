import { ReportBodyFallback } from './ReportBody';

/**
 * Date / searchParam switches stay inside /report — show table skeleton only,
 * not the full-client FreezeScreen from [slug]/loading.
 */
export default function ReportLoading() {
  return (
    <main className="wrap" data-wr-loading="1" aria-busy="true">
      <header className="head">
        <div>
          <div className="wr-skel" style={{ width: 280, height: 18 }} />
          <div className="wr-skel" style={{ width: 220, height: 10, marginTop: 8 }} />
        </div>
      </header>
      <div className="controls" aria-hidden>
        <div className="wr-skel" style={{ width: '100%', height: 36 }} />
      </div>
      <ReportBodyFallback />
    </main>
  );
}

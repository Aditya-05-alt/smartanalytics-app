import { Suspense } from 'react';
import ReportDateControls from '@/components/dashboard/wheeler-reports/ReportDateControls';
import { requireClient } from '@/lib/wheelerReports/auth';
import { addDays, isISODate, monthEnd, monthName, monthStart, rangeLabel, todayInZone } from '@/lib/wheelerReports/dates';
import ReportBody, { ReportBodyFallback } from './ReportBody';

type SP = Promise<{ from?: string; to?: string }>;

export default async function ReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SP }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { client } = await requireClient(slug);

  // Shell uses calendar today — no DB wait — so the screen paints immediately.
  const latest = todayInZone(client.timezone);
  const defaultMonth = `${latest.slice(0, 4)}-10-01`;
  let from = isISODate(sp.from) ? sp.from : monthStart(defaultMonth);
  let to = isISODate(sp.to) ? sp.to : monthEnd(defaultMonth);
  if (from > to) [from, to] = [to, from];

  const months: { label: string; from: string; to: string }[] = [];
  let m = monthStart(latest);
  for (let i = 0; i < 6; i++) {
    const fullEnd = monthEnd(m);
    const end = fullEnd <= latest ? fullEnd : latest;
    const fullMonth = end === fullEnd;
    months.unshift({
      label: fullMonth ? monthName(m) : `${monthName(m).split(' ')[0]} 1–${+end.slice(8)}`,
      from: m,
      to: end,
    });
    m = monthStart(addDays(m, -1));
  }

  const activeMonth = monthStart(from);
  const activeMonthEnd = monthEnd(activeMonth);
  const mFrom = activeMonth;
  const mTo = activeMonthEnd <= latest ? activeMonthEnd : latest;
  const mid = addDays(mFrom, 14);
  const quick = [
    { label: 'Whole period', from: mFrom, to: mTo },
    { label: `1–15`, from: mFrom, to: mid < mTo ? mid : mTo },
    ...(mid < mTo ? [{ label: `16–${+mTo.slice(8)}`, from: addDays(mid, 1), to: mTo }] : []),
    { label: 'Last 7 days', from: addDays(mTo, -6) < mFrom ? mFrom : addDays(mTo, -6), to: mTo },
  ];

  return (
    <main className="wrap">
      <header className="head">
        <div>
          <h1>{client.name} | Monthly Marketing Report</h1>
          <p className="sub">Google Ads, Meta Ads and website leads · Prepared by Wheeler</p>
        </div>
        <span className="badge">{rangeLabel(from, to)}</span>
      </header>

      <ReportDateControls slug={slug} from={from} to={to} months={months} quick={quick} />

      <Suspense key={`${from}_${to}`} fallback={<ReportBodyFallback />}>
        <ReportBody clientId={client.id} from={from} to={to} />
      </Suspense>
    </main>
  );
}

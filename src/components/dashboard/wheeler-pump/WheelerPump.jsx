'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import FilterDropdown from '../FilterDropdown';
import { monthKey, periodModel, r12Key } from '@/lib/wheelerPump/calc';
import { addClient, loadClientData, loadClients, loadMemberships } from '@/lib/wheelerPump/data';
import { NotesSheet } from './NotesSheet';
import { Card, cx, DashCtx } from './ui';
import Overview from './tabs/Overview';
import Brands from './tabs/Brands';
import Dealers from './tabs/Dealers';
import Rolling from './tabs/Rolling';
import NotesTab from './tabs/NotesTab';
import UploadTab from './tabs/UploadTab';

const TABS = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'brands', label: 'Brands & models', icon: '🏷️' },
  { id: 'dealers', label: 'Dealers & markets', icon: '🏪' },
  { id: 'r12', label: 'Rolling 12 months', icon: '📈' },
  { id: 'notes', label: 'Notes', icon: '📝' },
  { id: 'data', label: 'Upload & data', icon: '⬆️' },
];
const QUARTERLY_TABS = new Set(['overview', 'brands', 'dealers']);

/** Each load is one request with no progress events, so the percent eases toward 95% until it finishes. */
function useLoadPercent(active) {
  const [percent, setPercent] = useState(0);
  useEffect(() => {
    if (!active) {
      setPercent(100);
      return undefined;
    }
    setPercent(0);
    const timer = setInterval(() => {
      setPercent((value) => Math.min(95, value + Math.max(0.5, (95 - value) * 0.08)));
    }, 120);
    return () => clearInterval(timer);
  }, [active]);
  return Math.round(percent);
}

/** Home screen for the Wheeler team: one card per client. */
function ClientCards({ clients, onOpen }) {
  return (
    <div className={cx('clientGrid')}>
      {clients.map((c) => (
        <button key={c.id} type="button" className={cx('clientCard')} onClick={() => onOpen(c.id)}>
          <span className={cx('clientName')}>{c.name}</span>
          <span className={cx('clientStores')}>
            {(c.locations ?? []).map((l) => <span key={l} className={cx('pill')}>{l}</span>)}
          </span>
          <span className={cx('clientOpen')}>Open dashboard →</span>
        </button>
      ))}
    </div>
  );
}

function AddClientCard({ onAdded }) {
  const [form, setForm] = useState({ name: '', stores: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const add = async () => {
    const name = form.name.trim();
    const locations = form.stores.split(',').map((s) => s.trim()).filter(Boolean);
    if (!name || !locations.length) { setErr('Enter the client name and at least one store.'); return; }
    setSaving(true);
    setErr('');
    try {
      await addClient(name, locations);
      setForm({ name: '', stores: '' });
      await onAdded(name);
    } catch (error) {
      setErr(error.message);
    }
    setSaving(false);
  };
  return (
    <Card className={cx('addClient')} title="Add a client" sub="Then give people access on the Users page. Clients only ever see their own dashboard.">
      <div className={cx('formgrid')}>
        <div className={cx('field')}>
          <label htmlFor="wpClientName">Client name</label>
          <input id="wpClientName" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Brinson Powersports" />
        </div>
        <div className={cx('field')}>
          <label htmlFor="wpClientStores">Stores (comma separated)</label>
          <input id="wpClientStores" type="text" value={form.stores} onChange={(e) => setForm({ ...form, stores: e.target.value })} placeholder="Athens, Corsicana" />
        </div>
      </div>
      <div className={cx('actions')}>
        <button className={cx('btn', 'primary')} type="button" disabled={saving} onClick={add}>Add client</button>
        {err && <span className={cx('status', 'err')}>{err}</span>}
      </div>
    </Card>
  );
}

export default function WheelerPump() {
  const [memberships, setMemberships] = useState([]);
  const [clients, setClients] = useState(null);
  const [clientId, setClientId] = useState('');
  const [data, setData] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('overview');
  const [loc, setLoc] = useState('All');
  const [brand, setBrand] = useState('All');
  const [q, setQ] = useState(null);
  const [mode, setMode] = useState('q');
  const [sheet, setSheet] = useState(null);
  const [toastMsg, setToast] = useState('');
  const [showAddClient, setShowAddClient] = useState(false);

  const isAdmin = memberships.some((m) => m.role === 'wheeler_admin');
  const isWheeler = isAdmin || memberships.some((m) => m.role === 'wheeler');

  const refreshClients = useCallback(async (selectName) => {
    const list = await loadClients();
    setClients(list);
    // One client opens straight away; with several, the client cards are the home screen.
    setClientId((current) => {
      const named = selectName && list.find((c) => c.name === selectName);
      if (named) return named.id;
      if (list.some((c) => c.id === current)) return current;
      return list.length === 1 ? list[0].id : '';
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [roles] = await Promise.all([loadMemberships(), refreshClients()]);
        if (!cancelled) setMemberships(roles);
      } catch (error) {
        if (!cancelled) setErr(`Couldn't load Wheeler Pump: ${error.message}`);
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshClients]);

  const client = clients?.find((c) => c.id === clientId) || null;

  const reload = useCallback(async () => {
    if (!clientId) return;
    try {
      setData(await loadClientData(clientId));
    } catch (error) {
      setErr(`Couldn't load data: ${error.message}`);
    }
  }, [clientId]);

  useEffect(() => {
    setData(null);
    if (!clientId) return undefined;
    let cancelled = false;
    setDataLoading(true);
    setErr('');
    setLoc('All');
    setBrand('All');
    setQ(null);
    loadClientData(clientId)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setMode(result.q.length ? 'q' : result.m.length ? 'm' : result.r.length ? 'r12' : 'q');
      })
      .catch((error) => { if (!cancelled) setErr(`Couldn't load data: ${error.message}`); })
      .finally(() => { if (!cancelled) setDataLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  // The Overview / Brands / Dealers tabs run on calendar quarters or on rolling 12-month windows.
  const period = useMemo(() => periodModel(mode), [mode]);
  const periodRows = useMemo(() => {
    if (!data) return { sum: [], dl: [] };
    if (mode === 'q') return { sum: data.q, dl: data.qd };
    if (mode === 'm') {
      return {
        sum: data.m.map((r) => ({ ...r, quarter: monthKey(r.month) })),
        dl: data.md.map((d) => ({ ...d, quarter: monthKey(d.month) })),
      };
    }
    return {
      sum: data.r.map((r) => ({ ...r, quarter: r12Key(r.end) })),
      dl: data.rd.map((d) => ({ ...d, quarter: r12Key(d.end) })),
    };
  }, [data, mode]);
  const quarters = useMemo(
    () => period.sort(periodRows.sum.map((r) => r.quarter)).reverse(),
    [period, periodRows],
  );
  useEffect(() => {
    if (quarters.length && (!q || !quarters.includes(q))) setQ(quarters[0]);
  }, [quarters, q]);
  useEffect(() => {
    if (!toastMsg) return undefined;
    const timer = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(timer);
  }, [toastMsg]);

  const loading = bootLoading || dataLoading;
  const loadPercent = useLoadPercent(loading);

  const locs = client
    ? (client.locations?.length ? client.locations : [...new Set((data?.q ?? []).map((r) => r.location))])
    : [];
  const locOk = useCallback((r) => loc === 'All' || r.location === loc, [loc]);
  const brands = data ? [...new Set([...data.q, ...data.r, ...data.m].filter(locOk).map((r) => r.brand))].sort() : [];
  const brandValue = brands.includes(brand) ? brand : 'All';
  const brandOk = useCallback((r) => brandValue === 'All' || r.brand === brandValue, [brandValue]);

  const dash = client && data ? {
    client,
    data,
    sum: periodRows.sum,
    dl: periodRows.dl,
    period,
    loc,
    setLoc,
    q,
    setQ,
    brand: brandValue,
    setBrand,
    setTab,
    isWheeler,
    reload,
    toast: setToast,
    locOk,
    brandOk,
    openNotes: (ctx, label, compose) => setSheet({ ctx, label, compose }),
  } : null;

  const compareNote = tab === 'overview' && q
    ? `Changes compare ${period.label(q)} with ${period.label(period.prev(q))} (same stores and brands only)`
    : tab === 'r12'
      ? "Store and brand filters apply. The period picker doesn't."
      : tab === 'notes'
        ? 'Store and brand filters apply. Notes from every period are listed.'
        : '';

  const clientOptions = [
    ...((clients?.length ?? 0) > 1 ? [{ value: '', label: 'All clients' }] : []),
    ...(clients ?? []).map((c) => ({ value: c.id, label: c.name })),
  ];
  const storeOptions = [{ value: 'All', label: 'All stores' }, ...locs.map((l) => ({ value: l, label: l }))];
  const modeOptions = [
    { value: 'm', label: 'Monthly' },
    { value: 'q', label: 'Quarterly' },
    { value: 'r12', label: 'Rolling 12 months' },
  ];
  const MODE_NAMES = { m: 'monthly', q: 'quarterly', r12: 'rolling 12-month' };
  const quarterOptions = quarters.length
    ? quarters.map((x) => ({ value: x, label: period.label(x) }))
    : [{ value: '', label: 'No data' }];
  const brandOptions = [{ value: 'All', label: 'All brands' }, ...brands.map((b) => ({ value: b, label: b }))];

  const hasPeriodData = periodRows.sum.length > 0;
  const noAccess = !bootLoading && clients && clients.length === 0;
  const onHome = !clientId && (clients?.length ?? 0) > 1;

  let body;
  if (err) {
    body = <Card><p className={cx('status', 'err')}>{err}</p></Card>;
  } else if (noAccess) {
    body = (
      <Card title="No Wheeler Pump dashboards yet">
        <p className={cx('empty')}>
          {isWheeler
            ? 'No clients have been added yet.'
            : "Your login doesn't have access to any Wheeler Pump client. Ask a Wheeler admin to add you."}
        </p>
      </Card>
    );
  } else if (onHome) {
    body = (
      <>
        <ClientCards clients={clients} onOpen={setClientId} />
        {isAdmin && <AddClientCard onAdded={async (name) => { await refreshClients(name); setToast(`Added ${name}`); }} />}
      </>
    );
  } else if (!dash) {
    body = null;
  } else if (QUARTERLY_TABS.has(tab) && !hasPeriodData) {
    const other = ['q', 'm', 'r12'].find((x) => x !== mode && ({ q: data.q, m: data.m, r12: data.r }[x]).length);
    body = (
      <Card
        title={other ? `No ${MODE_NAMES[mode]} reports for ${client.name}` : 'No data yet'}
        sub={other
          ? `This client has ${MODE_NAMES[other]} reports. Switch the Period to see them in these views.`
          : 'Upload the OEM reports and the views will fill in here.'}
      >
        <button
          className={cx('btn', 'primary')}
          type="button"
          onClick={() => (other ? setMode(other) : setTab('data'))}
        >
          {other ? `Show ${MODE_NAMES[other]}` : 'Upload reports'}
        </button>
      </Card>
    );
  } else {
    body = (
      <>
        {tab === 'overview' && <Overview />}
        {tab === 'brands' && <Brands />}
        {tab === 'dealers' && <Dealers />}
        {tab === 'r12' && <Rolling />}
        {tab === 'notes' && <NotesTab />}
        {tab === 'data' && <UploadTab />}
      </>
    );
  }

  return (
    <DashCtx.Provider value={dash}>
      <div className={cx('root')} aria-busy={loading}>
        {loading && (
          <div className={`adc-table-overlay ${cx('loadingOverlay')}`} role="status" aria-live="polite" aria-label={`Loading ${loadPercent}%`}>
            <div className="adc-table-loader dealer-compare-loader">
              <span className="adc-table-spinner" aria-hidden />
              <span className="adc-table-loader-text">Loading {loadPercent}%</span>
            </div>
          </div>
        )}

        <div className="filters">
          <span className="f-label">Client</span>
          <FilterDropdown
            options={clientOptions.length ? clientOptions : [{ value: '', label: 'No clients' }]}
            defaultAll="__none__"
            value={clientId}
            onChange={setClientId}
            disabled={!clientOptions.length}
          />
          {!onHome && (
            <>
              <span className="f-label">Store</span>
              <FilterDropdown options={storeOptions} value={loc} onChange={setLoc} disabled={!client} />
              <span className="f-label">Period</span>
              <FilterDropdown
                options={modeOptions}
                defaultAll="__none__"
                value={mode}
                onChange={setMode}
                disabled={!data || tab === 'r12'}
              />
              <span className="f-label">{{ q: 'Quarter', m: 'Month', r12: 'Window' }[mode]}</span>
              <FilterDropdown
                options={quarterOptions}
                defaultAll="__none__"
                value={q ?? ''}
                onChange={setQ}
                disabled={!quarters.length || tab === 'r12'}
              />
              <span className="f-label">Brand</span>
              <FilterDropdown options={brandOptions} value={brandValue} onChange={setBrand} disabled={!data} />
            </>
          )}
          <div className="f-right">
            {compareNote && <span className={cx('filterNote')}>{compareNote}</span>}
            {memberships.length > 0 && (
              <span className={cx('roleBadge')}>{isAdmin ? 'Wheeler admin' : isWheeler ? 'Wheeler team' : 'Client view'}</span>
            )}
          </div>
        </div>

        {!onHome && (
          <div className={`page-tabs ${cx('tabsBar')}`}>
            {TABS.map((t) => (
              <button key={t.id} type="button" className={`pt ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="adc-nav-progress" role="progressbar" aria-label="Loading" aria-busy="true">
            <div className="adc-nav-progress-bar" />
          </div>
        )}

        <div className={`content ${cx('page')}`}>
          <div className={cx('heading')}>
            <div>
              <h1>Pump In / Pump Out{client ? ` — ${client.name}` : onHome ? ' — Clients' : ''}</h1>
              <p>
                {onHome
                  ? 'Pick a client to open its dashboard.'
                  : 'Local sales, units pumped in by other dealers and units pumped out to other markets, from OEM reports.'}
              </p>
            </div>
            <div className={cx('headActions')}>
              {client && (clients?.length ?? 0) > 1 && (
                <button className={cx('btn')} type="button" onClick={() => { setClientId(''); setShowAddClient(false); }}>
                  ← All clients
                </button>
              )}
              {isAdmin && !onHome && (
                <button className={cx('btn')} type="button" onClick={() => setShowAddClient((open) => !open)}>
                  {showAddClient ? 'Close' : '+ Add client'}
                </button>
              )}
            </div>
          </div>
          {isAdmin && showAddClient && !onHome && (
            <AddClientCard
              onAdded={async (name) => {
                await refreshClients(name);
                setShowAddClient(false);
                setToast(`Added ${name}`);
              }}
            />
          )}
          {body}
        </div>

        {dash && sheet && (
          <NotesSheet ctx={sheet.ctx} label={sheet.label} composeOnly={sheet.compose} onClose={() => setSheet(null)} />
        )}
        {toastMsg && <div className={cx('toast')} role="status">{toastMsg}</div>}
      </div>
    </DashCtx.Provider>
  );
}

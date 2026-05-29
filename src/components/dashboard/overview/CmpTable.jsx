'use client';

import { useState, useMemo, useCallback } from 'react';
import { Panel, PanelHeader } from '../Panel';
import Delta from '../Delta';
import { CHANNEL_COMPARISON } from '@/lib/data/channels';

function pct(a, b) {
  return b > 0 ? Math.round(((a - b) / b) * 100) : 0;
}

export default function CmpTable() {
  const [copied, setCopied] = useState(false);

  const rows = useMemo(() => {
    return CHANNEL_COMPARISON.map((r) => ({
      ...r,
      mom: pct(r.cur, r.prev),
      prevYoy: pct(r.prev, r.ly),
      yoy: pct(r.cur, r.ly),
    }));
  }, []);

  const totals = useMemo(() => {
    const cur = CHANNEL_COMPARISON.reduce((a, r) => a + r.cur, 0);
    const prev = CHANNEL_COMPARISON.reduce((a, r) => a + r.prev, 0);
    const ly = CHANNEL_COMPARISON.reduce((a, r) => a + r.ly, 0);
    return { cur, prev, ly, mom: pct(cur, prev), prevYoy: pct(prev, ly), yoy: pct(cur, ly) };
  }, []);

  const onCopy = useCallback(() => {
    const lines = ['Channel\tApr 2026 VDP\tMoM%\tMar 2026 VDP\tPrev YoY%\tApr 2025 VDP\tYoY%'];
    rows.forEach((r) => {
      lines.push(
        `${r.ch}\t${r.cur}\t${r.mom >= 0 ? '+' : ''}${r.mom}%\t${r.prev}\t${r.prevYoy >= 0 ? '+' : ''}${r.prevYoy}%\t${r.ly}\t${r.yoy >= 0 ? '+' : ''}${r.yoy}%`
      );
    });
    lines.push(
      `Total VDP\t${totals.cur}\t${totals.mom >= 0 ? '+' : ''}${totals.mom}%\t${totals.prev}\t${totals.prevYoy >= 0 ? '+' : ''}${totals.prevYoy}%\t${totals.ly}\t${totals.yoy >= 0 ? '+' : ''}${totals.yoy}%`
    );
    navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  }, [rows, totals]);

  return (
    <Panel>
      <PanelHeader
        title="VDP Views by Channel — Period Comparison"
        badge={{ label: 'Copy-ready', bg: 'var(--acc-soft)', color: 'var(--acc)' }}
      >
        <div className="ph-s" style={{ marginLeft: 8 }}>
          Current MTD vs Prev MTD vs Same Month Last Year
        </div>
        <button
          type="button"
          className={`copy-btn ${copied ? 'copied' : ''}`}
          onClick={onCopy}
          style={{ marginLeft: 'auto' }}
        >
          {copied ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy table
            </>
          )}
        </button>
      </PanelHeader>

      <div className="cmp-table-wrap">
        <table className="cmp-tbl">
          <thead>
            <tr>
              <th>Channel</th>
              <th colSpan="2" className="col-cur">Current MTD — Apr 2026</th>
              <th colSpan="2" className="col-prev">Previous MTD — Mar 2026</th>
              <th colSpan="2" className="col-lyear">Same Month Last Year — Apr 2025</th>
            </tr>
            <tr>
              <th>Channel</th>
              <th className="col-cur">VDP Views</th>
              <th className="col-cur">MoM Δ</th>
              <th className="col-prev">VDP Views</th>
              <th className="col-prev">YoY Δ</th>
              <th className="col-lyear">VDP Views</th>
              <th className="col-lyear">YoY % vs Cur</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ch}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
                    <span>{r.ch}</span>
                  </div>
                </td>
                <td className="col-cur">{r.cur.toLocaleString()}</td>
                <td className="col-cur"><Delta value={r.mom} /></td>
                <td className="col-prev">{r.prev.toLocaleString()}</td>
                <td className="col-prev"><Delta value={r.prevYoy} size={10} /></td>
                <td className="col-lyear">{r.ly.toLocaleString()}</td>
                <td className="col-lyear"><Delta value={r.yoy} size={10} /></td>
              </tr>
            ))}
            <tr>
              <td>Total VDP</td>
              <td className="col-cur">{totals.cur.toLocaleString()}</td>
              <td className="col-cur"><Delta value={totals.mom} /></td>
              <td className="col-prev">{totals.prev.toLocaleString()}</td>
              <td className="col-prev"><Delta value={totals.prevYoy} size={10} /></td>
              <td className="col-lyear">{totals.ly.toLocaleString()}</td>
              <td className="col-lyear"><Delta value={totals.yoy} size={10} /></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        style={{
          padding: '.5rem .875rem',
          borderTop: '1px solid var(--bd)',
          fontSize: 10,
          color: 'var(--t3)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(200,232,122,.15)', border: '1px solid rgba(200,232,122,.3)' }} />
        Current period &nbsp;&nbsp;
        <div style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(111,160,255,.1)', border: '1px solid rgba(111,160,255,.2)' }} />
        Previous period &nbsp;&nbsp;
        <div style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(184,155,255,.08)', border: '1px solid rgba(184,155,255,.2)' }} />
        Last year same month
        <span style={{ marginLeft: 'auto' }}>
          MTD = Month to date · All times reflect client timezone
        </span>
      </div>
    </Panel>
  );
}

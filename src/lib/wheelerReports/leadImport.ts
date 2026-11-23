// Turns a website lead export (Scout CSV) into lead rows.
// Email and phone are never stored: they only feed a one-way person hash.
// Contact name is kept for the report leads drill-down.
import Papa from 'papaparse';
import { createHash } from 'node:crypto';
import { dateInZone } from './dates';
import type { Lead, Store } from './types';

export type LeadImportResult = {
  leads: (Lead & { created_at_utc: string | null; person_hash: string; contact_name: string })[];
  skippedOutsideDates: number;
  unknownLocations: Record<string, number>;
  badRows: number;
};

const col = (row: Record<string, string>, ...names: string[]) => {
  for (const n of names) if (row[n] != null) return String(row[n]).trim();
  return '';
};

export function parseLeadExport(
  csvText: string,
  stores: Pick<Store, 'id' | 'lead_locations'>[],
  timeZone: string,
  opts: { from?: string; to?: string } = {},
): LeadImportResult {
  const parsed = Papa.parse<Record<string, string>>(csvText.replace(/^﻿/, ''), { header: true, skipEmptyLines: true });
  const byLocation = new Map<string, string>();
  for (const s of stores) for (const loc of s.lead_locations) byLocation.set(loc.trim().toLowerCase(), s.id);

  const out: LeadImportResult = { leads: [], skippedOutsideDates: 0, unknownLocations: {}, badRows: 0 };
  for (const row of parsed.data) {
    const id = col(row, 'Lead ID', 'lead_id', 'id');
    const created = col(row, 'Created At', 'created_at');
    const t = created ? new Date(created) : null;
    if (!id || !t || Number.isNaN(t.getTime())) { out.badRows++; continue; }
    const date = dateInZone(t, timeZone);
    if ((opts.from && date < opts.from) || (opts.to && date > opts.to)) { out.skippedOutsideDates++; continue; }

    const location = col(row, 'Location', 'Store');
    const storeId = byLocation.get(location.toLowerCase()) ?? null;
    if (!storeId) out.unknownLocations[location || '(blank)'] = (out.unknownLocations[location || '(blank)'] || 0) + 1;

    let source = col(row, 'UTM Source') || col(row, 'Lead Source') || col(row, 'Source');
    let medium = col(row, 'UTM Medium');
    if (!source || source.toLowerCase() === 'direct') { source = '(direct)'; medium = '(none)'; }
    if (/^facebook/i.test(source)) source = 'facebook';
    medium = medium || '(none)';

    // Campaign: Google Ads leads carry the campaign id in "Lead Source Detail" (google/cpc/<id>),
    // Google Business Profile leads a google_my_business_* tag.
    let campaign = col(row, 'UTM Campaign');
    const detail = col(row, 'Lead Source Detail').split('/');
    const s = source.toLowerCase(), m = medium.toLowerCase();
    if (s === 'google' && m === 'cpc' && /^\d+$/.test(detail[2] || '')) campaign = detail[2];
    if (s === 'google' && m === 'organic' && (detail[2] || '').startsWith('google_my_business')) campaign = detail[2];

    const who = (col(row, 'Email') || col(row, 'Phone') || col(row, 'Visitor ID') || id).toLowerCase();
    const first = col(row, 'First Name', 'FirstName', 'first_name');
    const last = col(row, 'Last Name', 'LastName', 'last_name');
    const full = col(row, 'Name', 'Full Name', 'Contact Name', 'contact_name');
    const contact_name = (full || [first, last].filter(Boolean).join(' ')).trim();
    out.leads.push({
      external_id: id,
      store_id: storeId,
      lead_date: date,
      created_at_utc: t.toISOString(),
      source,
      medium,
      campaign,
      lead_type: col(row, 'Lead Type'),
      form: col(row, 'Form Name', 'Form'),
      contact_name,
      person_hash: createHash('sha256').update(who).digest('hex').slice(0, 16),
    });
  }
  return out;
}

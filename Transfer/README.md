# Campaign Views — Transfer Bundle

Copy of all files needed to clone the **Campaign Views** tab (WA| campaigns: KPIs, table, day-wise line chart, date×campaign matrix) into another Next.js + Supabase project.

## What's included

### UI
| Path | Purpose |
|------|---------|
| `src/components/vdp/CampaignsView.jsx` | Main Campaign Views screen |
| `src/components/vdp/VdpChart.jsx` | Chart.js wrapper |
| `src/components/vdp/VdpLoadingBanner.jsx` | Loading states |
| `src/components/vdp/VdpUi.jsx` | Card, Kpi, Toolbar UI primitives |
| `src/components/vdp/VdpDateRangeContext.jsx` | Date range + compare context |
| `src/app/dashboard/campaigns_advance/page.jsx` | Route page |
| `src/app/dashboard/campaigns/page.jsx` | Redirect to campaigns_advance |
| `src/app/vdp.css` | Styles (import in your layout) |

### API + client
| Path | Purpose |
|------|---------|
| `src/app/api/dashboard/campaign-views_advance/route.js` | Next.js API route |
| `src/lib/api/campaignViews.js` | Browser fetch helper |

### Client / dealer context
| Path | Purpose |
|------|---------|
| `src/components/dashboard/ClientContext.jsx` | `ClientProvider` + `useClient()` — dealer picker state |
| `src/lib/dashboard/allDealers.js` | `ALL_DEALER_CLIENT`, `isAllDealerClient()` |
| `src/lib/dashboard/dashboardPrefs.js` | Persist selected dealer per dashboard area |
| `src/lib/data/categories.js` | Per-vertical config (RV, etc.) |
| `src/lib/dealers/fields.js` | Dealer category options + normalization |
| `src/lib/supabase/client.js` | Browser Supabase client |
| `src/lib/supabase/server.js` | Server Supabase client (auth API) |
| `src/lib/access/permissions.js` | Report/dealer access defaults |
| `src/lib/access/userAccess.js` | Load user roles from DB |
| `src/app/api/auth/access/route.js` | `GET /api/auth/access` for ClientProvider |
| `supabase/migrations/smart_user_access.sql` | User roles/reports/dealers tables (optional) |

### Shared libs
| Path | Purpose |
|------|---------|
| `src/lib/vdp/aggregates.js` | fmt, pct, momClass, safeDiv |
| `src/lib/vdp/mockData.js` | Required by aggregates.js imports |
| `src/lib/vdp/dateRange.js` | VDP date/compare modes |
| `src/lib/overview/comparePeriod.js` | PoP / MoM date math |
| `src/lib/ga4/dateRange.js` | Calendar ISO helpers |
| `src/components/dashboard/CalendarRangePicker.jsx` | Used by dateRange.js |

### Supabase RPCs
| Path | Function |
|------|----------|
| `supabase/rpc/get_wa_campaign_views_advance.sql` | `get_wa_campaign_views_advance` |
| `supabase/rpc/get_wa_campaign_cells_advance.sql` | `get_wa_campaign_cells_advance` |
| `supabase/rpc/idx_ga4_wa_campaign_client_date.sql` | Performance index |

## Still wire in your project

- Wrap your dashboard layout with **`<ClientProvider>`** and **`<VdpDateRangeProvider>`**.
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- **DB tables:**
  - `public.smart_hoot_config` — dealers (`id`, `customer_name`, `ga4_customer_id`, …)
  - `public.smart_ga4_page_data` — campaign data (`client_id`, `report_date`, `session_campaign`, `views`, …)
  - Optional: `smart_user_roles`, `smart_user_reports`, `smart_user_dealers` (from `smart_user_access.sql`)
- **npm:** `chart.js`, `react`, `next`, `@supabase/supabase-js`, `@supabase/ssr`.
- Campaign Views uses **`client.ga4CustomerId`** as the RPC `client_id`.

## Setup in the new project

1. Copy `src/` and `supabase/rpc/` folders into your project (merge paths).
2. Run the three SQL files in Supabase SQL editor (index uses `CONCURRENTLY` — run outside a transaction).
3. Add route: `/dashboard/campaigns_advance` → `campaigns_advance/page.jsx`.
4. Import `vdp.css` in your dashboard layout.
5. Wrap the dashboard with `ClientProvider` and `VdpDateRangeProvider`.
6. Add nav link to `/dashboard/campaigns_advance`.
7. (Optional) Run `supabase/migrations/smart_user_access.sql` if you use per-user dealer/report access.

## API

```
GET /api/dashboard/campaign-views_advance?clientId=&from=&to=&pageType=ALL|VDP
```

Returns `{ campaigns, daily, cells, meta }` — only `WA|` / `WA |` session campaigns for one dealer.

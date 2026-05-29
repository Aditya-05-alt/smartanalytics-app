# SmartAnalytics — Next.js (JSX)

A Next.js 14 (App Router) implementation of the SmartAnalytics auth flow — Login and Sign Up — built in JSX (no TypeScript) with Tailwind CSS, a softer dark UI, and a wired-up Supabase integration layer.

## Stack

- **Next.js 14** (App Router, JSX only)
- **React 18** with `useFormState` / `useFormStatus` Server Action forms
- **Tailwind CSS 3** + CSS custom properties for theming
- **Supabase SSR** (`@supabase/ssr`) — placeholder client/server helpers ready to plug in
- Google Fonts: **Syne** (display) + **DM Sans** (body) loaded via `next/font` (zero CLS)

## Design

The original `smartanalytics ui v3.html` uses a very dark `#0A0C0F` base. This app lightens the palette ~30% (`#14171C` → `#2B2F3A`) for a softer "dim" feel while keeping the lime-green accent (`#C8E87A`) and the data-viz palette intact.

All theme tokens live as CSS variables in `src/app/globals.css` and are exposed to Tailwind via `tailwind.config.js`.

## File structure

```
smartanalytics-app/
├── public/
│   └── favicon.svg
├── src/
│   ├── app/
│   │   ├── layout.jsx              # Root layout, fonts, ambient bg
│   │   ├── page.jsx                # Redirects → /login
│   │   ├── globals.css             # Theme tokens + form primitives
│   │   ├── login/page.jsx          # /login route
│   │   ├── signup/page.jsx         # /signup route
│   │   └── dashboard/page.jsx      # Placeholder post-auth route
│   ├── components/
│   │   ├── auth/
│   │   │   ├── AuthLayout.jsx      # Split-screen branded shell
│   │   │   ├── LoginForm.jsx       # Sign-in form (Server Action)
│   │   │   └── SignupForm.jsx      # Sign-up form (Server Action)
│   │   └── ui/
│   │       ├── Logo.jsx
│   │       ├── Input.jsx           # Label, icon, error, show/hide pwd
│   │       └── Button.jsx          # Primary + ghost, loading state
│   └── lib/
│       ├── supabase/
│       │   ├── client.js           # Browser client (createBrowserClient)
│       │   └── server.js           # Server client (createServerClient)
│       └── auth/
│           └── actions.js          # signInAction / signUpAction / signOutAction
├── .env.local.example
├── jsconfig.json
├── next.config.mjs
├── package.json
├── postcss.config.mjs
└── tailwind.config.js
```

## Performance notes (fast DOM)

- All animations use **GPU-accelerated transforms** (`translate3d`) and `will-change`.
- Body is promoted to its own compositor layer (`transform: translateZ(0)`).
- Heavy SVG icons are wrapped in `React.memo` so they don't re-render with parent state.
- Form state is local + co-located — no global store, no provider re-renders.
- `useMemo` / `useCallback` only where it actually saves work (password strength, handlers).
- `next/font` self-hosts Google Fonts → zero CLS, no third-party fetch.
- `experimental.optimizePackageImports` tree-shakes Supabase deeply.
- Supabase calls are **Server Actions**, so the client bundle stays tiny.

## Getting started

```bash
npm install
npm run dev
```

Then open <http://localhost:3000> — you'll be redirected to `/login`.

## Wiring up Supabase

1. Copy `.env.local.example` → `.env.local`
2. Fill in your Supabase URL and anon key from <https://app.supabase.com> → *Project Settings → API*
3. Restart `npm run dev`

That's it — `signInAction` and `signUpAction` (in `src/lib/auth/actions.js`) will start hitting real Supabase auth. Until env vars are set, the forms surface a friendly "not configured" message instead of crashing.

## Routes

| Route        | Purpose                              |
| ------------ | ------------------------------------ |
| `/`          | Redirects to `/login`                |
| `/login`     | Sign in form                         |
| `/signup`    | Create account form                  |
| `/dashboard` | Placeholder, lands here after auth   |

## Next steps

- Port the full dashboard UI (overview, health, attribution, local, admin) from `smartanalytics ui v3.html` into `src/app/dashboard/`
- Add middleware (`src/middleware.js`) to protect `/dashboard` once Supabase env is set
- Add `/forgot-password` + `/reset-password` routes

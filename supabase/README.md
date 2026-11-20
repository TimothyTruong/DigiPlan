# Accounts & sync setup (Supabase, free plan)

The app works without this (everything stays in the browser). Doing this turns on Google / email-link sign-in and
sync across devices. ~15 minutes. **Never share or commit the database password or the `service_role` key.**

## 1. Create the project
1. https://supabase.com → New project → **Free** plan. Pick the region closest to you (e.g. *Canada (Central)* or *US East*).
2. Save the database password in your password manager. The app never needs it.

## 2. Create the table + security rules
SQL Editor → New query → paste all of `supabase/migrations/20261120000000_records.sql` → **Run**.
(It's safe to run again.) This creates one `records` table with row-level security: each user can only read/write
their own rows, signed-out visitors can't read anything. These rules are covered by tests (`src/lib/cloud/__tests__/rls.test.ts`).

## 3. Allowed URLs
Authentication → URL Configuration:
- **Site URL**: `https://timothytruong.github.io/DigiPlan/`
- **Redirect URLs** (add both): `https://timothytruong.github.io/DigiPlan/**` and `http://localhost:5173/**`

## 4. Google sign-in
1. https://console.cloud.google.com → create/select a project.
2. APIs & Services → **OAuth consent screen**: External, app name "Petal", your support email.
   Scopes: only `openid`, `email`, `profile` (no review needed for these). Add yourself under Test users, or Publish.
3. APIs & Services → **Credentials** → Create credentials → OAuth client ID → **Web application**:
   - Authorized JavaScript origins: `https://timothytruong.github.io`, `http://localhost:5173`
   - Authorized redirect URIs: `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (exact value shown in Supabase → Authentication → Providers → Google)
4. Supabase → Authentication → Providers → **Google** → enable → paste the Client ID and Client secret.
   The secret lives only in Supabase.
5. Optional: the same Client ID also powers Settings → Google Calendar (set it as `VITE_GOOGLE_CLIENT_ID` below).
   Calendar scopes are requested separately and are "sensitive": until Google verifies the app, only listed test users can connect a calendar.

## 5. Email sign-in links
Authentication → Providers → Email: enabled (magic links are on by default). The app only offers passwordless links.
Supabase's built-in email sender is for testing and allows only a few emails per hour. Before inviting other people,
set Authentication → Emails → **SMTP Settings** to a real provider (e.g. Resend, free tier).

## 6. Connect the app
Project Settings → **Data API** → copy the **Project URL** (it looks like `https://<project-id>.supabase.co`; do **not** include
`/rest/v1/`). Project Settings → **API Keys** → copy the **publishable** key (`sb_publishable_…`, called "anon public" on older
projects). Both are safe to expose; RLS protects data. Never use the `sb_secret_…` / `service_role` key — the deploy refuses it.
- **Live site**: GitHub repo → Settings → Secrets and variables → Actions → **Variables** → add
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (and `VITE_GOOGLE_CLIENT_ID` if using Calendar).
  Then Actions → "Deploy to GitHub Pages" → **Run workflow** (or push any commit).
- **Local dev**: put the same two lines in `.env.local` (git-ignored) and run `npm run dev`.

## Free-plan notes
- Free projects pause after ~1 week with no traffic; open the dashboard to resume. No automatic backups — keep using Settings → Download backup.
- What syncs: classes, notes, links, tasks/events, recipes, meal plan, grocery, workouts, habits, wellness/health data, budget, settings and themes.
  Not yet: uploaded files, photos and custom cover/icon images (they stay on the device that uploaded them).

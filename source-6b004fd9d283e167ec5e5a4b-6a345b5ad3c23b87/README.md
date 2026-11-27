# Tasks – personal to-do PWA

Plain HTML/CSS/JS + Supabase (auth, Postgres, realtime). No build step.

## 1. Supabase
1. Create a project at supabase.com.
2. **SQL Editor → New query**, paste `schema.sql`, click **Run**.
3. **Project Settings → API**: copy the *Project URL* and the *anon public* key into `config.js`.
4. **Authentication → Sign In / Providers → Email**: keep email enabled. Decide whether to require email confirmation.
5. Open the deployed app, **create your account**, then go to **Authentication → Sign In / Providers** and turn **off "Allow new users to sign up"** so nobody else can register.

## 2. Netlify
- Easiest: go to app.netlify.com/drop and drag this folder (or the zip) in.
- Or connect a Git repo; no build command, publish directory `.`.
- Then **Authentication → URL Configuration** in Supabase: set *Site URL* to your Netlify URL (needed for confirmation emails).

## 3. Install
- **Samsung Android (Chrome or Samsung Internet):** open the site, then menu → *Install app* / *Add to Home screen* (or use the in-app **Install** button).
- **Desktop Chrome/Edge:** click the install icon in the address bar, or the in-app **Install** button.

## Updating
Change `CACHE_VERSION` in `sw.js` whenever you edit any file so installed copies pick up the change.

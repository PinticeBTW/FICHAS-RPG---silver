# Ghost Grid

Ghost Grid is a private RPG campaign web app for one GM and a small player group. It is an original cyber-futuristic dashboard inspired by premium cyberpunk interface mood, but it does not copy branded assets, layouts, text, or IP from existing games.

The current MVP includes:

- original landing and login experience
- central PDF archive for all character sheets
- browser-native PDF reader inside the app
- GM-only PDF import flow
- protected routing
- Supabase auth and data layer
- Vercel-ready SPA routing

## Stack

- React 19
- Vite
- TypeScript
- Tailwind CSS
- Supabase
- React Router

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm run dev
```

3. Connect Supabase.

- Copy [`.env.example`](/c:/Users/tomas/Desktop/RPGSILVER/.env.example) to `.env`
- Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Run the SQL in [`supabase/schema.sql`](/c:/Users/tomas/Desktop/RPGSILVER/supabase/schema.sql)
- Ensure Silver's profile has `role = 'gm'`
- Log in and use the archive page to import PDFs into Supabase Storage

If env vars are missing, the login/register form stays disabled until Supabase is configured.

## Supabase Setup

1. Create a new Supabase project.
2. Open the SQL editor and run [`schema.sql`](/c:/Users/tomas/Desktop/RPGSILVER/supabase/schema.sql).
3. In Authentication, enable Email auth.
4. Have Silver sign up once so the auth trigger creates a `profiles` row automatically.
5. In the table editor, change Silver's `profiles.role` to `gm`.
6. The SQL also creates the `campaign-pdfs` storage bucket and the policies for reading/uploading PDFs.

### Data Model

- `profiles`
- `campaigns`
- `campaign_members`
- `characters`
- `character_stats`
- `character_skills`
- `character_abilities`
- `character_inventory`
- `character_cyberware`
- `character_notes`

### Permission Model

- authenticated users can read imported PDFs in the archive
- only the GM can upload, replace, or delete PDFs in the `campaign-pdfs` bucket
- the relational tables remain available for future campaign data work

## Project Structure

```text
src/
  app/
  components/
    auth/
    character/
    common/
    cyberware/
    dashboard/
  hooks/
  layouts/
  lib/
  pages/
  providers/
  styles/
  types/
supabase/
  schema.sql
  seed.sql
```

## Deployment To Vercel

1. Push the project to GitHub.
2. Import the repository into Vercel.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Vercel project settings.
4. Deploy.

[`vercel.json`](/c:/Users/tomas/Desktop/RPGSILVER/vercel.json) already includes the SPA rewrite needed for React Router.

## Useful Commands

```bash
npm run dev
npm run build
npm run preview
```

## Notes

- The app now opens directly in the PDF archive after login.
- The built-in reader uses the browser's PDF viewer, so it feels close to Edge or Acrobat without needing a heavy custom PDF engine.

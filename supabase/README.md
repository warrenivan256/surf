# Surf live backend setup

This folder contains Surf's first real multi-user backend schema and browser configuration. The current demo UI does not connect to a database until a Supabase project is created and its public project URL and anon/publishable key are added to `config.js`.

## Setup

1. Create a Supabase project.
2. In its SQL Editor, run all of `schema.sql`.
3. Run `profile-assets.sql` in the SQL Editor to enable public profile pictures and banners. Re-running this migration is safe.
4. In **Authentication → Providers → Email**, enable email/password sign-in. For easier local prototyping, email confirmation may be disabled; for a public app, configure email confirmation and an SMTP provider.
5. Copy the Project URL and anon/publishable key from **Project Settings → API** into `config.js`.
6. Serve the `outputs` folder from a local web server or deploy it to HTTPS hosting. Do not open `index.html` as a `file://` URL for the live backend.

The anon/publishable key is meant to be present in a browser client. Never use the Supabase `service_role` secret in frontend code or commit it to this folder. Row Level Security is enabled on the tables in `schema.sql`.

## Current scope

The schema establishes authenticated profiles, private birth dates, friend requests, blocks, mutes, direct messages, group chats, and expiring stories. `profile-assets.sql` enables persistent, publicly viewable profile pictures and banners; story images remain in private storage.

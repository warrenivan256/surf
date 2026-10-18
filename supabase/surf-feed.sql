-- Surf Feed: text-first posts with optional photo/video attachments.
-- Safe to rerun. This does not modify existing photo-profile posts.

create table if not exists public.surf_feed_posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 500),
  media_path text,
  media_type text check (media_type in ('image','video') or media_type is null),
  created_at timestamptz not null default now(),
  constraint surf_feed_posts_body_or_media check (char_length(trim(body)) > 0 or media_path is not null)
);
create index if not exists surf_feed_posts_created_idx on public.surf_feed_posts(created_at desc);
create index if not exists surf_feed_posts_owner_created_idx on public.surf_feed_posts(owner_id, created_at desc);

create table if not exists public.surf_feed_likes (
  post_id uuid not null references public.surf_feed_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
create table if not exists public.surf_feed_reposts (
  post_id uuid not null references public.surf_feed_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
create table if not exists public.surf_feed_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.surf_feed_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists surf_feed_comments_post_idx on public.surf_feed_comments(post_id, created_at asc);
create table if not exists public.surf_feed_saved_posts (
  post_id uuid not null references public.surf_feed_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);

alter table public.surf_feed_posts enable row level security;
alter table public.surf_feed_likes enable row level security;
alter table public.surf_feed_reposts enable row level security;
alter table public.surf_feed_comments enable row level security;
alter table public.surf_feed_saved_posts enable row level security;

drop policy if exists "Signed in users read Surf Feed posts" on public.surf_feed_posts;
create policy "Signed in users read Surf Feed posts" on public.surf_feed_posts
  for select to authenticated using (not exists (
    select 1 from public.blocks b where
      (b.blocker_id = auth.uid() and b.blocked_id = owner_id) or
      (b.blocker_id = owner_id and b.blocked_id = auth.uid())
  ));
drop policy if exists "Users create own Surf Feed posts" on public.surf_feed_posts;
create policy "Users create own Surf Feed posts" on public.surf_feed_posts
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "Users delete own Surf Feed posts" on public.surf_feed_posts;
create policy "Users delete own Surf Feed posts" on public.surf_feed_posts
  for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "Signed in users read Surf Feed likes" on public.surf_feed_likes;
create policy "Signed in users read Surf Feed likes" on public.surf_feed_likes for select to authenticated using (true);
drop policy if exists "Users like Surf Feed posts" on public.surf_feed_likes;
create policy "Users like Surf Feed posts" on public.surf_feed_likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users unlike Surf Feed posts" on public.surf_feed_likes;
create policy "Users unlike Surf Feed posts" on public.surf_feed_likes for delete to authenticated using (user_id = auth.uid());

drop policy if exists "Signed in users read Surf Feed reposts" on public.surf_feed_reposts;
create policy "Signed in users read Surf Feed reposts" on public.surf_feed_reposts for select to authenticated using (true);
drop policy if exists "Users repost Surf Feed posts" on public.surf_feed_reposts;
create policy "Users repost Surf Feed posts" on public.surf_feed_reposts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users remove Surf Feed reposts" on public.surf_feed_reposts;
create policy "Users remove Surf Feed reposts" on public.surf_feed_reposts for delete to authenticated using (user_id = auth.uid());

drop policy if exists "Signed in users read Surf Feed comments" on public.surf_feed_comments;
create policy "Signed in users read Surf Feed comments" on public.surf_feed_comments for select to authenticated using (true);
drop policy if exists "Users comment on Surf Feed posts" on public.surf_feed_comments;
create policy "Users comment on Surf Feed posts" on public.surf_feed_comments for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users delete own Surf Feed comments" on public.surf_feed_comments;
create policy "Users delete own Surf Feed comments" on public.surf_feed_comments for delete to authenticated using (user_id = auth.uid());

drop policy if exists "Users read own saved Surf Feed posts" on public.surf_feed_saved_posts;
create policy "Users read own saved Surf Feed posts" on public.surf_feed_saved_posts for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users save Surf Feed posts" on public.surf_feed_saved_posts;
create policy "Users save Surf Feed posts" on public.surf_feed_saved_posts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users unsave Surf Feed posts" on public.surf_feed_saved_posts;
create policy "Users unsave Surf Feed posts" on public.surf_feed_saved_posts for delete to authenticated using (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('surf-feed-media', 'surf-feed-media', false, 104857600,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Surf Feed media readable by signed in users" on storage.objects;
create policy "Surf Feed media readable by signed in users" on storage.objects for select to authenticated
  using (bucket_id = 'surf-feed-media');
drop policy if exists "Users upload own Surf Feed media" on storage.objects;
create policy "Users upload own Surf Feed media" on storage.objects for insert to authenticated
  with check (bucket_id = 'surf-feed-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users update own Surf Feed media" on storage.objects;
create policy "Users update own Surf Feed media" on storage.objects for update to authenticated
  using (bucket_id = 'surf-feed-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'surf-feed-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users delete own Surf Feed media" on storage.objects;
create policy "Users delete own Surf Feed media" on storage.objects for delete to authenticated
  using (bucket_id = 'surf-feed-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Enable live feed refreshes where Supabase Realtime is available.
do $$ begin
  begin alter publication supabase_realtime add table public.surf_feed_posts; exception when duplicate_object then null; end;
exception when undefined_object then null; end $$;

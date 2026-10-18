-- Surf post detail interactions: likes and comments. Run once in Supabase SQL Editor.
create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check(char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
drop policy if exists "Signed-in users read post likes" on public.post_likes;
create policy "Signed-in users read post likes" on public.post_likes for select to authenticated using (true);
drop policy if exists "Users like posts" on public.post_likes;
create policy "Users like posts" on public.post_likes for insert to authenticated with check (user_id=auth.uid());
drop policy if exists "Users unlike posts" on public.post_likes;
create policy "Users unlike posts" on public.post_likes for delete to authenticated using (user_id=auth.uid());
drop policy if exists "Signed-in users read post comments" on public.post_comments;
create policy "Signed-in users read post comments" on public.post_comments for select to authenticated using (true);
drop policy if exists "Users comment on posts" on public.post_comments;
create policy "Users comment on posts" on public.post_comments for insert to authenticated with check (user_id=auth.uid());
drop policy if exists "Users delete own comments" on public.post_comments;
create policy "Users delete own comments" on public.post_comments for delete to authenticated using (user_id=auth.uid());

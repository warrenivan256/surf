-- Persistent photo/video posts, people tags, and saved posts for Surf.
-- Run the whole file once in Supabase Dashboard > SQL Editor.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  media_path text not null,
  media_type text not null check (media_type in ('image','video')),
  caption text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists posts_owner_created_idx on public.posts(owner_id, created_at desc);

create table if not exists public.post_tags (
  post_id uuid not null references public.posts(id) on delete cascade,
  tagged_user_id uuid not null references public.profiles(id) on delete cascade,
  tagged_by uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key(post_id, tagged_user_id)
);
create table if not exists public.saved_posts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, post_id)
);

alter table public.posts enable row level security;
alter table public.post_tags enable row level security;
alter table public.saved_posts enable row level security;
drop policy if exists "Signed-in users view posts" on public.posts;
create policy "Signed-in users view posts" on public.posts for select to authenticated using (not exists (
  select 1 from public.blocks b where (b.blocker_id = auth.uid() and b.blocked_id = owner_id) or (b.blocker_id = owner_id and b.blocked_id = auth.uid())
));
drop policy if exists "Owners create posts" on public.posts;
create policy "Owners create posts" on public.posts for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "Owners delete posts" on public.posts;
create policy "Owners delete posts" on public.posts for delete to authenticated using (owner_id = auth.uid());
drop policy if exists "Users read post tags" on public.post_tags;
create policy "Users read post tags" on public.post_tags for select to authenticated using (true);
drop policy if exists "Owners tag people on own posts" on public.post_tags;
create policy "Owners tag people on own posts" on public.post_tags for insert to authenticated with check (
  tagged_by = auth.uid() and exists (select 1 from public.posts p where p.id = post_id and p.owner_id = auth.uid())
);
drop policy if exists "Taggers remove tags from own posts" on public.post_tags;
create policy "Taggers remove tags from own posts" on public.post_tags for delete to authenticated using (tagged_by = auth.uid());
drop policy if exists "Users view own saved posts" on public.saved_posts;
create policy "Users view own saved posts" on public.saved_posts for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users save posts" on public.saved_posts;
create policy "Users save posts" on public.saved_posts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users unsave posts" on public.saved_posts;
create policy "Users unsave posts" on public.saved_posts for delete to authenticated using (user_id = auth.uid());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('surf-post-media','surf-post-media',false,104857600,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Surf users view post media" on storage.objects;
create policy "Surf users view post media" on storage.objects for select to authenticated using(bucket_id='surf-post-media');
drop policy if exists "Surf users upload post media" on storage.objects;
create policy "Surf users upload post media" on storage.objects for insert to authenticated with check(bucket_id='surf-post-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Surf users delete own post media" on storage.objects;
create policy "Surf users delete own post media" on storage.objects for delete to authenticated using(bucket_id='surf-post-media' and (storage.foldername(name))[1]=auth.uid()::text);

do $$
begin
  begin alter publication supabase_realtime add table public.posts; exception when duplicate_object then null; end;
exception when undefined_object then null;
end
$$;

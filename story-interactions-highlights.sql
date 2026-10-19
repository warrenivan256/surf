-- Story viewers, likes, and saved highlights for existing Surf projects.
-- Run the entire file in Supabase Dashboard > SQL Editor.

create table if not exists public.story_views (
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create table if not exists public.story_likes (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create table if not exists public.story_highlights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  story_id uuid not null references public.stories(id) on delete cascade,
  title text not null default 'Highlights' check (char_length(title) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (owner_id, story_id, title)
);

alter table public.story_views enable row level security;
alter table public.story_likes enable row level security;
alter table public.story_highlights enable row level security;

drop policy if exists "View story viewers" on public.story_views;
create policy "View story viewers" on public.story_views for select to authenticated using (
  viewer_id = auth.uid() or exists (
    select 1 from public.stories s where s.id = story_id and s.owner_id = auth.uid()
  )
);
drop policy if exists "Record own story views" on public.story_views;
create policy "Record own story views" on public.story_views for insert to authenticated with check (
  viewer_id = auth.uid() and exists (
    select 1 from public.stories s where s.id = story_id and s.owner_id <> auth.uid()
  )
);

drop policy if exists "View story likes" on public.story_likes;
create policy "View story likes" on public.story_likes for select to authenticated using (
  user_id = auth.uid() or exists (
    select 1 from public.stories s where s.id = story_id and s.owner_id = auth.uid()
  )
);
drop policy if exists "Like visible stories" on public.story_likes;
create policy "Like visible stories" on public.story_likes for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.stories s where s.id = story_id and s.owner_id <> auth.uid())
);
drop policy if exists "Remove own story likes" on public.story_likes;
create policy "Remove own story likes" on public.story_likes for delete to authenticated using (user_id = auth.uid());

drop policy if exists "View friend story highlights" on public.story_highlights;
create policy "View friend story highlights" on public.story_highlights for select to authenticated using (
  owner_id = auth.uid() or exists (
    select 1 from public.friend_requests f where f.status = 'accepted' and
      ((f.requester_id = auth.uid() and f.addressee_id = owner_id) or
       (f.addressee_id = auth.uid() and f.requester_id = owner_id))
  )
);
drop policy if exists "Owners add their stories to highlights" on public.story_highlights;
create policy "Owners add their stories to highlights" on public.story_highlights for insert to authenticated with check (
  owner_id = auth.uid() and exists (
    select 1 from public.stories s where s.id = story_id and s.owner_id = auth.uid()
  )
);
drop policy if exists "Owners remove stories from highlights" on public.story_highlights;
create policy "Owners remove stories from highlights" on public.story_highlights for delete to authenticated using (owner_id = auth.uid());

-- Owners can still see expired stories saved to a highlight. Viewers can see
-- active stories or saved highlights from accepted friends.
drop policy if exists "Users view visible active stories" on public.stories;
create policy "Users view visible active stories" on public.stories for select to authenticated using (
  not exists (
    select 1 from public.blocks b where
      (b.blocker_id = auth.uid() and b.blocked_id = owner_id) or
      (b.blocker_id = owner_id and b.blocked_id = auth.uid())
  ) and (
    owner_id = auth.uid() or
    (expires_at > now() and (visibility = 'public' or exists (
      select 1 from public.friend_requests f where f.status = 'accepted' and
        ((f.requester_id = auth.uid() and f.addressee_id = owner_id) or
         (f.addressee_id = auth.uid() and f.requester_id = owner_id))
    ))) or
    exists (
      select 1 from public.story_highlights h where h.story_id = stories.id and
        (h.owner_id = auth.uid() or exists (
          select 1 from public.friend_requests f where f.status = 'accepted' and
            ((f.requester_id = auth.uid() and f.addressee_id = h.owner_id) or
             (f.addressee_id = auth.uid() and f.requester_id = h.owner_id))
        ))
    )
  )
);

do $$
begin
  begin
    alter publication supabase_realtime add table public.story_likes;
  exception when duplicate_object then
    null;
  end;
  begin
    alter publication supabase_realtime add table public.story_views;
  exception when duplicate_object then
    null;
  end;
exception when undefined_object then
  null;
end
$$;

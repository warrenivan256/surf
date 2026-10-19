-- Surf's initial production schema for Supabase.
-- Apply this file in Supabase Dashboard > SQL Editor before connecting the app.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 24),
  display_name text not null default '',
  bio text not null default '' check (char_length(bio) <= 300),
  avatar_path text,
  banner_path text,
  is_minor boolean not null default false,
  social_links jsonb not null default '{}'::jsonb,
  status text not null default 'online' check (status in ('online','dnd','offline')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Birth dates are private and can only be read by their owner.
create table if not exists public.profile_private (
  user_id uuid primary key references auth.users(id) on delete cascade,
  date_of_birth date not null,
  country text,
  username_changed_at timestamptz
);

alter table public.profiles add column if not exists is_minor boolean not null default false;
alter table public.profiles add column if not exists social_links jsonb not null default '{}'::jsonb;

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.mutes (
  muter_id uuid not null references public.profiles(id) on delete cascade,
  muted_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);

create table if not exists public.group_conversations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.group_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.group_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('image','text')),
  media_path text,
  body text check (char_length(body) <= 1000),
  background_color text,
  visibility text not null default 'friends' check (visibility in ('friends','public')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  check ((kind = 'image' and media_path is not null) or (kind = 'text' and body is not null))
);

create index if not exists friend_requests_addressee_status_idx on public.friend_requests(addressee_id, status);
create index if not exists direct_messages_pair_time_idx on public.direct_messages(sender_id, recipient_id, created_at desc);
create index if not exists stories_owner_expiry_idx on public.stories(owner_id, expires_at desc);
create index if not exists group_messages_group_time_idx on public.group_messages(group_id, created_at desc);

create or replace function public.is_surf_group_member(group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = $1 and gm.user_id = auth.uid()
  );
$$;

create or replace function public.add_surf_group_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.group_members(group_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;
drop trigger if exists on_surf_group_created on public.group_conversations;
create trigger on_surf_group_created after insert on public.group_conversations
  for each row execute procedure public.add_surf_group_owner();

create or replace function public.sync_surf_public_age_label()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles
    set is_minor = (new.date_of_birth > (current_date - interval '18 years')::date)
    where id = new.user_id;
  return new;
end;
$$;

drop trigger if exists on_surf_private_birthdate_changed on public.profile_private;
create trigger on_surf_private_birthdate_changed
  after insert or update of date_of_birth on public.profile_private
  for each row execute procedure public.sync_surf_public_age_label();

update public.profiles p
  set is_minor = (pp.date_of_birth > (current_date - interval '18 years')::date)
  from public.profile_private pp
  where pp.user_id = p.id;

create or replace function public.create_surf_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  requested_username text;
  birth_date date;
begin
  requested_username := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  birth_date := nullif(new.raw_user_meta_data ->> 'date_of_birth', '')::date;
  if requested_username is null or birth_date is null then
    raise exception 'Username and date of birth are required';
  end if;
  insert into public.profiles(id, username, display_name)
  values (new.id, requested_username, requested_username);
  insert into public.profile_private(user_id, date_of_birth)
  values (new.id, birth_date);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_surf on auth.users;
create trigger on_auth_user_created_surf
  after insert on auth.users
  for each row execute procedure public.create_surf_profile();

alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.friend_requests enable row level security;
alter table public.blocks enable row level security;
alter table public.mutes enable row level security;
alter table public.direct_messages enable row level security;
alter table public.group_conversations enable row level security;
alter table public.group_members enable row level security;
alter table public.group_messages enable row level security;
alter table public.stories enable row level security;

drop policy if exists "Signed-in users can find profiles" on public.profiles;
create policy "Signed-in users can find profiles" on public.profiles
  for select to authenticated using (true);
drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "Users read their private profile" on public.profile_private;
create policy "Users read their private profile" on public.profile_private
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users update their private profile" on public.profile_private;
create policy "Users update their private profile" on public.profile_private
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Participants view friend requests" on public.friend_requests;
create policy "Participants view friend requests" on public.friend_requests
  for select to authenticated using (auth.uid() in (requester_id, addressee_id));
drop policy if exists "Users send friend requests" on public.friend_requests;
create policy "Users send friend requests" on public.friend_requests
  for insert to authenticated with check (auth.uid() = requester_id and not exists (
    select 1 from public.blocks b where
      (b.blocker_id = auth.uid() and b.blocked_id = addressee_id) or
      (b.blocker_id = addressee_id and b.blocked_id = auth.uid())
  ));
drop policy if exists "Addressee responds to pending requests" on public.friend_requests;
create policy "Addressee responds to pending requests" on public.friend_requests
  for update to authenticated using (auth.uid() = addressee_id and status = 'pending')
  with check (auth.uid() = addressee_id and status in ('accepted','declined'));
drop policy if exists "Requester cancels own requests" on public.friend_requests;
create policy "Requester cancels own requests" on public.friend_requests
  for delete to authenticated using (auth.uid() = requester_id);

drop policy if exists "Users view blocks they are part of" on public.blocks;
create policy "Users view blocks they are part of" on public.blocks
  for select to authenticated using (auth.uid() in (blocker_id, blocked_id));
drop policy if exists "Users manage their own blocks" on public.blocks;
create policy "Users manage their own blocks" on public.blocks
  for insert to authenticated with check (auth.uid() = blocker_id);
drop policy if exists "Users remove their own blocks" on public.blocks;
create policy "Users remove their own blocks" on public.blocks
  for delete to authenticated using (auth.uid() = blocker_id);
drop policy if exists "Users manage their own mutes" on public.mutes;
create policy "Users manage their own mutes" on public.mutes
  for all to authenticated using (auth.uid() = muter_id) with check (auth.uid() = muter_id);

drop policy if exists "Message participants read direct messages" on public.direct_messages;
create policy "Message participants read direct messages" on public.direct_messages
  for select to authenticated using (auth.uid() in (sender_id, recipient_id));
drop policy if exists "Users send direct messages" on public.direct_messages;
create policy "Users send direct messages" on public.direct_messages
  for insert to authenticated with check (auth.uid() = sender_id and not exists (
    select 1 from public.blocks b where
      (b.blocker_id = sender_id and b.blocked_id = recipient_id) or
      (b.blocker_id = recipient_id and b.blocked_id = sender_id)
  ));
drop policy if exists "Recipients mark messages read" on public.direct_messages;
create policy "Recipients mark messages read" on public.direct_messages
  for update to authenticated using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

drop policy if exists "Members view their groups" on public.group_conversations;
create policy "Members view their groups" on public.group_conversations
  for select to authenticated using (public.is_surf_group_member(id));
drop policy if exists "Users create groups" on public.group_conversations;
create policy "Users create groups" on public.group_conversations
  for insert to authenticated with check (auth.uid() = owner_id);
drop policy if exists "Owners rename groups" on public.group_conversations;
create policy "Owners rename groups" on public.group_conversations
  for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "Owners delete groups" on public.group_conversations;
create policy "Owners delete groups" on public.group_conversations
  for delete to authenticated using (auth.uid() = owner_id);
drop policy if exists "Members see group membership" on public.group_members;
create policy "Members see group membership" on public.group_members
  for select to authenticated using (public.is_surf_group_member(group_id));
drop policy if exists "Group owners add accepted friends" on public.group_members;
create policy "Group owners add accepted friends" on public.group_members
  for insert to authenticated with check (
    exists (select 1 from public.group_conversations g where g.id = group_id and g.owner_id = auth.uid())
    and exists (select 1 from public.friend_requests f where f.status = 'accepted' and
      ((f.requester_id = auth.uid() and f.addressee_id = user_id) or
       (f.addressee_id = auth.uid() and f.requester_id = user_id)))
  );
drop policy if exists "Owners or members leave groups" on public.group_members;
create policy "Owners or members leave groups" on public.group_members
  for delete to authenticated using (
    auth.uid() = user_id or exists (select 1 from public.group_conversations g
      where g.id = group_id and g.owner_id = auth.uid() and user_id <> auth.uid())
  );
drop policy if exists "Group members read group messages" on public.group_messages;
create policy "Group members read group messages" on public.group_messages
  for select to authenticated using (public.is_surf_group_member(group_id));
drop policy if exists "Group members send messages" on public.group_messages;
create policy "Group members send messages" on public.group_messages
  for insert to authenticated with check (
    auth.uid() = sender_id and public.is_surf_group_member(group_id)
  );

drop policy if exists "Users view visible active stories" on public.stories;
create policy "Users view visible active stories" on public.stories
  for select to authenticated using (
    expires_at > now() and (
      owner_id = auth.uid() or visibility = 'public' or exists (
        select 1 from public.friend_requests f where f.status = 'accepted' and
          ((f.requester_id = auth.uid() and f.addressee_id = owner_id) or
           (f.addressee_id = auth.uid() and f.requester_id = owner_id))
      )
    ) and not exists (
      select 1 from public.blocks b where
        (b.blocker_id = auth.uid() and b.blocked_id = owner_id) or
        (b.blocker_id = owner_id and b.blocked_id = auth.uid())
    )
  );
drop policy if exists "Users manage their own stories" on public.stories;
create policy "Users manage their own stories" on public.stories
  for insert to authenticated with check (auth.uid() = owner_id);
drop policy if exists "Users delete their own stories" on public.stories;
create policy "Users delete their own stories" on public.stories
  for delete to authenticated using (auth.uid() = owner_id);

-- Enable realtime for message delivery and friend request updates.
do $$ begin
  begin alter publication supabase_realtime add table public.direct_messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.group_messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.friend_requests; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.stories; exception when duplicate_object then null; end;
exception when undefined_object then null;
end $$;

-- Private story images. Upload to `<auth.uid()>/<story-id>/<filename>` and store
-- that same path in stories.media_path. A viewer can read only an active story
-- row permitted by the stories table's RLS policy.
insert into storage.buckets (id, name, public)
values ('surf-stories', 'surf-stories', false)
on conflict (id) do nothing;

drop policy if exists "Owners upload their story files" on storage.objects;
create policy "Owners upload their story files" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'surf-stories' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "Viewers read permitted story files" on storage.objects;
create policy "Viewers read permitted story files" on storage.objects
  for select to authenticated using (
    bucket_id = 'surf-stories' and exists (
      select 1 from public.stories s where s.media_path = storage.objects.name
    )
  );
drop policy if exists "Owners delete their story files" on storage.objects;
create policy "Owners delete their story files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'surf-stories' and (storage.foldername(name))[1] = auth.uid()::text
  );

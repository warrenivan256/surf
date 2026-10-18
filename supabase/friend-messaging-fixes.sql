-- Surf friend, presence, and chat image fixes. Review and run in Supabase SQL Editor.
-- Allows either participant to remove an accepted friendship; pending requests remain controlled by existing policies.
drop policy if exists "Participants remove accepted friendships" on public.friend_requests;
create policy "Participants remove accepted friendships" on public.friend_requests
  for delete to authenticated using (
    auth.uid() in (requester_id, addressee_id) and status = 'accepted'
  );

-- Allow the live app to store image messages while retaining text messages.
alter table public.direct_messages add column if not exists media_path text;
alter table public.direct_messages drop constraint if exists direct_messages_body_check;
alter table public.direct_messages drop constraint if exists direct_messages_body_or_media_check;
alter table public.direct_messages add constraint direct_messages_body_or_media_check
  check (char_length(body) between 0 and 5000 and (char_length(body) > 0 or media_path is not null));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('surf-chat-media', 'surf-chat-media', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "Surf chat participants read image attachments" on storage.objects;
create policy "Surf chat participants read image attachments" on storage.objects
for select to authenticated using (
  bucket_id = 'surf-chat-media' and exists (
    select 1 from public.direct_messages m
    where m.media_path = name and auth.uid() in (m.sender_id, m.recipient_id)
  )
);
drop policy if exists "Surf users upload own chat images" on storage.objects;
create policy "Surf users upload own chat images" on storage.objects
for insert to authenticated with check (
  bucket_id = 'surf-chat-media' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "Surf users delete own chat images" on storage.objects;
create policy "Surf users delete own chat images" on storage.objects
for delete to authenticated using (
  bucket_id = 'surf-chat-media' and (storage.foldername(name))[1] = auth.uid()::text
);


-- Persistent follow counts for profile pages.
create table if not exists public.surf_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);
alter table public.surf_follows enable row level security;
drop policy if exists "Surf follows are publicly countable by signed in users" on public.surf_follows;
create policy "Surf follows are publicly countable by signed in users" on public.surf_follows
  for select to authenticated using (true);
drop policy if exists "Users follow from their own account" on public.surf_follows;
create policy "Users follow from their own account" on public.surf_follows
  for insert to authenticated with check (follower_id = auth.uid());
drop policy if exists "Users unfollow from their own account" on public.surf_follows;
create policy "Users unfollow from their own account" on public.surf_follows
  for delete to authenticated using (follower_id = auth.uid());

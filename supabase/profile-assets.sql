-- Run once in Supabase SQL Editor to enable persistent profile pictures/banners.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'surf-profile-assets',
  'surf-profile-assets',
  true,
  10485760,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view Surf profile images" on storage.objects;
create policy "Public can view Surf profile images" on storage.objects
  for select to public using (bucket_id = 'surf-profile-assets');

drop policy if exists "Users upload their own Surf profile images" on storage.objects;
create policy "Users upload their own Surf profile images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'surf-profile-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update their own Surf profile images" on storage.objects;
create policy "Users update their own Surf profile images" on storage.objects
  for update to authenticated using (
    bucket_id = 'surf-profile-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'surf-profile-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete their own Surf profile images" on storage.objects;
create policy "Users delete their own Surf profile images" on storage.objects
  for delete to authenticated using (
    bucket_id = 'surf-profile-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Let owners see their groups even if the owner-membership trigger was missing
-- when a group was first created, and let the app repair that membership.
create or replace function public.is_surf_group_owner(target_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_conversations g
    where g.id = target_group and g.owner_id = auth.uid()
  );
$$;

drop policy if exists "Members view their groups" on public.group_conversations;
drop policy if exists "Owners and members view their groups" on public.group_conversations;
create policy "Owners and members view their groups" on public.group_conversations
  for select to authenticated using (owner_id = auth.uid() or public.is_surf_group_member(id));

drop policy if exists "Group owners add themselves" on public.group_members;
create policy "Group owners add themselves" on public.group_members
  for insert to authenticated with check (
    user_id = auth.uid() and public.is_surf_group_owner(group_id)
  );

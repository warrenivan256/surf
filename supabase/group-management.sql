-- Idempotent Surf group-management migration.
-- Safe to rerun: existing groups and messages are not deleted.

alter table public.group_conversations
  add column if not exists bio text not null default '' check (char_length(bio) <= 300),
  add column if not exists avatar_path text;

alter table public.group_members drop constraint if exists group_members_role_check;
alter table public.group_members
  add constraint group_members_role_check check (role in ('owner', 'admin', 'member'));

create or replace function public.is_surf_group_admin(group_uuid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_conversations g
    where g.id = group_uuid and g.owner_id = auth.uid()
  ) or exists (
    select 1 from public.group_members gm
    where gm.group_id = group_uuid and gm.user_id = auth.uid()
      and gm.role in ('owner', 'admin')
  );
$$;

-- Group rows: members can see groups; owners/admins can edit/delete.
drop policy if exists "Members view their groups" on public.group_conversations;
drop policy if exists "Owners and members view their groups" on public.group_conversations;
create policy "Owners and members view their groups" on public.group_conversations
  for select to authenticated using (
    owner_id = auth.uid() or public.is_surf_group_member(id)
  );

drop policy if exists "Users create groups" on public.group_conversations;
create policy "Users create groups" on public.group_conversations
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "Owners rename groups" on public.group_conversations;
drop policy if exists "Group admins edit details" on public.group_conversations;
create policy "Group admins edit details" on public.group_conversations
  for update to authenticated using (public.is_surf_group_admin(id))
  with check (public.is_surf_group_admin(id));

drop policy if exists "Owners delete groups" on public.group_conversations;
drop policy if exists "Group admins delete groups" on public.group_conversations;
create policy "Group admins delete groups" on public.group_conversations
  for delete to authenticated using (public.is_surf_group_admin(id));

-- Membership: list members, add accepted friends, change roles, remove members/leave.
drop policy if exists "Members see group membership" on public.group_members;
drop policy if exists "Members view group members" on public.group_members;
create policy "Members view group members" on public.group_members
  for select to authenticated using (
    user_id = auth.uid() or public.is_surf_group_member(group_id)
  );

drop policy if exists "Group owners add accepted friends" on public.group_members;
drop policy if exists "Group admins add accepted friends" on public.group_members;
create policy "Group admins add accepted friends" on public.group_members
  for insert to authenticated with check (
    public.is_surf_group_admin(group_id)
    and role in ('admin', 'member')
    and user_id <> auth.uid()
    and exists (
      select 1 from public.friend_requests f where f.status = 'accepted' and
        ((f.requester_id = auth.uid() and f.addressee_id = user_id) or
         (f.addressee_id = auth.uid() and f.requester_id = user_id))
    )
  );

drop policy if exists "Group admins manage members" on public.group_members;
create policy "Group admins manage members" on public.group_members
  for update to authenticated using (
    public.is_surf_group_admin(group_id) and role <> 'owner'
  ) with check (
    public.is_surf_group_admin(group_id) and role in ('admin', 'member')
    and user_id <> (select owner_id from public.group_conversations where id = group_id)
  );

drop policy if exists "Owners or members leave groups" on public.group_members;
drop policy if exists "Group admins remove members" on public.group_members;
create policy "Group admins remove members" on public.group_members
  for delete to authenticated using (
    auth.uid() = user_id or (
      public.is_surf_group_admin(group_id)
      and user_id <> (select owner_id from public.group_conversations where id = group_id)
    )
  );

-- Group messages must be visible to members and only sent by the logged-in member.
drop policy if exists "Group members read group messages" on public.group_messages;
create policy "Group members read group messages" on public.group_messages
  for select to authenticated using (public.is_surf_group_member(group_id));
drop policy if exists "Group members send messages" on public.group_messages;
create policy "Group members send messages" on public.group_messages
  for insert to authenticated with check (
    auth.uid() = sender_id and public.is_surf_group_member(group_id)
  );

-- Group avatar storage.
insert into storage.buckets (id, name, public)
values ('surf-group-assets', 'surf-group-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "Group avatars are public" on storage.objects;
create policy "Group avatars are public" on storage.objects
  for select to public using (bucket_id = 'surf-group-assets');
drop policy if exists "Group admins upload avatars" on storage.objects;
create policy "Group admins upload avatars" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'surf-group-assets'
    and public.is_surf_group_admin((storage.foldername(name))[1]::uuid)
  );
drop policy if exists "Group admins update avatars" on storage.objects;
create policy "Group admins update avatars" on storage.objects
  for update to authenticated using (
    bucket_id = 'surf-group-assets'
    and public.is_surf_group_admin((storage.foldername(name))[1]::uuid)
  ) with check (
    bucket_id = 'surf-group-assets'
    and public.is_surf_group_admin((storage.foldername(name))[1]::uuid)
  );
drop policy if exists "Group admins delete avatars" on storage.objects;
create policy "Group admins delete avatars" on storage.objects
  for delete to authenticated using (
    bucket_id = 'surf-group-assets'
    and public.is_surf_group_admin((storage.foldername(name))[1]::uuid)
  );

-- Realtime: friends should see profile presence changes without refreshing.
do $$ begin
  begin alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.group_messages;
  exception when duplicate_object then null; end;
exception when undefined_object then null;
end $$;

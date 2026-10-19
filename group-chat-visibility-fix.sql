-- Surf group visibility and live updates fix. Safe to rerun; does not delete groups or messages.
create or replace function public.is_surf_group_member(group_uuid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_conversations g
    where g.id = group_uuid and g.owner_id = auth.uid()
  ) or exists (
    select 1 from public.group_members gm
    where gm.group_id = group_uuid and gm.user_id = auth.uid()
  );
$$;

drop policy if exists "Owners and members view their groups" on public.group_conversations;
create policy "Owners and members view their groups" on public.group_conversations
for select to authenticated using (owner_id = auth.uid() or public.is_surf_group_member(id));

drop policy if exists "Members view group members" on public.group_members;
create policy "Members view group members" on public.group_members
for select to authenticated using (user_id = auth.uid() or public.is_surf_group_member(group_id));

drop policy if exists "Group members read group messages" on public.group_messages;
create policy "Group members read group messages" on public.group_messages
for select to authenticated using (public.is_surf_group_member(group_id));

drop policy if exists "Group members send messages" on public.group_messages;
create policy "Group members send messages" on public.group_messages
for insert to authenticated with check (auth.uid() = sender_id and public.is_surf_group_member(group_id));

do $$ begin
  begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.group_messages; exception when duplicate_object then null; end;
exception when undefined_object then null; end $$;

-- Add delivery state, account-level read receipt preferences, and story actions.
-- Run the whole file once in Supabase Dashboard > SQL Editor.
alter table public.direct_messages add column if not exists delivered_at timestamptz;
alter table public.profiles add column if not exists read_receipts_enabled boolean not null default true;

create or replace function public.enforce_surf_read_receipt_preferences()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.read_at is distinct from old.read_at and not coalesce((
    select p.read_receipts_enabled from public.profiles p where p.id = new.recipient_id
  ), true) then
    new.read_at := old.read_at;
  end if;
  return new;
end
$$;
drop trigger if exists enforce_surf_read_receipt_preferences on public.direct_messages;
create trigger enforce_surf_read_receipt_preferences before update of read_at on public.direct_messages
for each row execute function public.enforce_surf_read_receipt_preferences();

drop policy if exists "Recipients mark messages read" on public.direct_messages;
create policy "Recipients mark delivery state" on public.direct_messages
for update to authenticated using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

drop policy if exists "Owners archive their stories" on public.stories;
create policy "Owners archive their stories" on public.stories
for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

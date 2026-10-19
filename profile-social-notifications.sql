-- Surf profile badges/social links and realtime story notifications.
-- Run after the main schema.sql has been applied.

alter table public.profiles
  add column if not exists is_minor boolean not null default false;
alter table public.profiles
  add column if not exists social_links jsonb not null default '{}'::jsonb;

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

do $$ begin
  begin alter publication supabase_realtime add table public.stories;
  exception when duplicate_object then null; end;
exception when undefined_object then null;
end $$;

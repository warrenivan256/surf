-- Enables mutual-follow unfriend behavior for Surf profile pages.
-- Removes only the relationship between the authenticated user and the chosen user.
create or replace function public.surf_unfriend(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if target_user_id is null or target_user_id = auth.uid() then
    raise exception 'Invalid user to unfriend';
  end if;

  delete from public.surf_follows
  where (follower_id = auth.uid() and followed_id = target_user_id)
     or (follower_id = target_user_id and followed_id = auth.uid());
end;
$$;

revoke all on function public.surf_unfriend(uuid) from public;
grant execute on function public.surf_unfriend(uuid) to authenticated;

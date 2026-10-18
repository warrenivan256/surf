-- Surf post comments: nested replies and delete permissions for post owners. Safe to rerun.
alter table public.post_comments add column if not exists parent_comment_id uuid references public.post_comments(id) on delete cascade;

alter table public.post_comments enable row level security;
drop policy if exists "Signed-in users read post comments" on public.post_comments;
create policy "Signed-in users read post comments" on public.post_comments for select to authenticated using (true);
drop policy if exists "Users comment on posts" on public.post_comments;
create policy "Users comment on posts" on public.post_comments for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users and post owners delete comments" on public.post_comments;
drop policy if exists "Users delete own comments" on public.post_comments;
create policy "Users and post owners delete comments" on public.post_comments for delete to authenticated using (user_id = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and p.owner_id = auth.uid()));

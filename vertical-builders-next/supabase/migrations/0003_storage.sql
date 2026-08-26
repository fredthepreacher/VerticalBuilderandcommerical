-- ============================================================================
-- Vertical Ops — Migration 0003: private document storage
-- ----------------------------------------------------------------------------
-- One PRIVATE bucket. No public read. All reads go through short-lived signed
-- URLs minted server-side after an authorisation check; all writes go through
-- server route handlers / server actions.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vertical-private-documents',
  'vertical-private-documents',
  false,
  10485760,                                   -- 10 MB, mirrors app_settings.max_upload_mb
  array['application/pdf','image/jpeg','image/png','image/webp',
        'application/zip','text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Signed-in staff may read objects through the API as well as via signed URLs.
drop policy if exists vertical_docs_read on storage.objects;
create policy vertical_docs_read on storage.objects
  for select to authenticated
  using (bucket_id = 'vertical-private-documents' and public.can_read());

drop policy if exists vertical_docs_write on storage.objects;
create policy vertical_docs_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'vertical-private-documents' and public.can_write());

drop policy if exists vertical_docs_update on storage.objects;
create policy vertical_docs_update on storage.objects
  for update to authenticated
  using (bucket_id = 'vertical-private-documents' and public.can_write());

-- No delete policy: documents are archived in the app, never removed, so audit
-- packages generated months ago still resolve. Admin cleanup happens in the
-- Supabase dashboard if it is ever genuinely required.

-- Explicitly deny anonymous access to the bucket.
drop policy if exists vertical_docs_no_anon on storage.objects;
create policy vertical_docs_no_anon on storage.objects
  for select to anon
  using (false);

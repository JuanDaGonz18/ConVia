-- =====================================================================
-- ConVía — los buckets de Storage existen (migraciones 004, 033 y 042)
--
-- Uso local: npx supabase db query -f supabase/tests/storage_buckets_test.sql
-- Solo lee; el bloque termina con RAISE EXCEPTION y el mensaje es el
-- reporte. Cada línea dice OK o BAD.
-- =====================================================================
do $$
declare
  r text := ''; bad integer; b text; fv storage.buckets%rowtype;
begin
  foreach b in array array['avatars', 'vehicle-photos', 'face-verifications', 'pickup-clips'] loop
    if exists (select 1 from storage.buckets where id = b) then
      r := r || E'\nOK  bucket exists: ' || b;
    else
      r := r || E'\nBAD bucket missing: ' || b;
    end if;
  end loop;

  select * into fv from storage.buckets where id = 'face-verifications';
  if found and not fv.public then r := r || E'\nOK  face-verifications is private';
  else r := r || E'\nBAD face-verifications is not private'; end if;
  if found and fv.file_size_limit = 10485760 then r := r || E'\nOK  face-verifications limit 10 MB';
  else r := r || E'\nBAD face-verifications limit: ' || coalesce(fv.file_size_limit::text, 'null'); end if;
  if found and fv.allowed_mime_types @> array['image/jpeg', 'image/png'] then r := r || E'\nOK  face-verifications allows jpeg and png';
  else r := r || E'\nBAD face-verifications mime types: ' || coalesce(fv.allowed_mime_types::text, 'null'); end if;

  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and coalesce(qual, '') || coalesce(with_check, '') like '%face-verifications%') then
    r := r || E'\nOK  face-verifications policies present';
  else
    r := r || E'\nBAD face-verifications policies missing';
  end if;

  bad := (length(r) - length(replace(r, E'\nBAD', ''))) / 4;
  raise exception 'STORAGE BUCKETS — % failing:%', bad, r;
end $$;

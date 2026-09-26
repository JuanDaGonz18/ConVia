-- =====================================================================
-- WheelsApp — Storage (buckets + políticas) y datos semilla
-- Convención de rutas: <bucket>/<auth.uid()>/<archivo>
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',            'avatars',            true,  5242880,  array['image/jpeg','image/png','image/webp']),
  ('vehicle-photos',     'vehicle-photos',     true,  10485760, array['image/jpeg','image/png','image/webp']),
  ('face-verifications', 'face-verifications', false, 10485760, array['image/jpeg','image/png'])
on conflict (id) do nothing;

-- avatars y vehicle-photos: lectura pública, escritura solo en su carpeta
create policy "public_images_read" on storage.objects
  for select to public
  using (bucket_id in ('avatars', 'vehicle-photos'));

create policy "own_images_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('avatars', 'vehicle-photos')
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own_images_update" on storage.objects
  for update to authenticated
  using (bucket_id in ('avatars', 'vehicle-photos')
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own_images_delete" on storage.objects
  for delete to authenticated
  using (bucket_id in ('avatars', 'vehicle-photos')
         and (storage.foldername(name))[1] = auth.uid()::text);

-- face-verifications: privado; el usuario sube y ve solo lo suyo
create policy "face_own_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'face-verifications'
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "face_own_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'face-verifications'
         and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- Semilla: instituciones permitidas
-- ---------------------------------------------------------------------
insert into public.institutions (nombre, tipo, dominio) values
  ('Universidad de La Sabana', 'universidad', 'unisabana.edu.co')
on conflict (dominio) do nothing;

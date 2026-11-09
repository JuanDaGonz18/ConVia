-- =====================================================================
-- ConVía — bucket privado face-verifications (idempotente)
--
-- Producción no tenía el bucket (la migración 004 lo crea, pero no quedó en
-- el proyecto remoto), y verify-student-id fallaba al guardar las imágenes de
-- la revisión manual con "Bucket not found". Se crea igual que en la 004 y,
-- si ya existe, no se toca. Las políticas de storage.objects para este bucket
-- (creadas en migraciones anteriores) dependen solo de bucket_id: no se tocan y siguen vigentes.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('face-verifications', 'face-verifications', false, 10485760, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

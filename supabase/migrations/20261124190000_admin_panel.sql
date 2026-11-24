-- =====================================================================
-- ConVía — panel de administración web
--
-- La misma revisión que hacen scripts/admin/review-cli.mjs (carnés en
-- revisión) y las solicitudes de institución, pero desde la web con la
-- sesión del administrador (private.admins). Todo pasa por funciones que
-- revisan private.is_admin(): una persona que no es administradora recibe
-- NOT_ADMIN aunque encuentre la dirección del panel.
--
-- Las imágenes del carné en revisión (face-verifications/<user>/
-- student-card-review-*.jpg, sin la cara) se pueden leer y borrar solo
-- desde una sesión de administrador.
-- =====================================================================

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.admins where user_id = (select auth.uid()));
$$;
revoke execute on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

drop policy if exists admin_review_files_read on storage.objects;
create policy admin_review_files_read on storage.objects for select to authenticated
  using (bucket_id = 'face-verifications'
         and storage.filename(name) like 'student-card-review-%'
         and (select private.is_admin()));

drop policy if exists admin_review_files_delete on storage.objects;
create policy admin_review_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'face-verifications'
         and storage.filename(name) like 'student-card-review-%'
         and (select private.is_admin()));

-- ¿Es administrador? Para que el panel muestre "no encontrado" sin pedir más datos.
create or replace function public.am_i_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin();
$$;
revoke execute on function public.am_i_admin() from public, anon;
grant execute on function public.am_i_admin() to authenticated;

-- Todo lo que el panel muestra, en una sola llamada.
create or replace function public.admin_panel()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'NOT_ADMIN'; end if;
  return jsonb_build_object(
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', m.user_id,
               'nombre', p.nombre,
               'email', p.email,
               'institucion', i.nombre,
               'desde', m.updated_at,
               'check', case when c.id is null then null else jsonb_build_object(
                 'kind', c.kind, 'decision', c.decision, 'reasons', c.reasons,
                 'name_similarity', c.name_similarity, 'institution_read', c.institution_read,
                 'email_domain', c.email_domain, 'expires_on', c.expires_on,
                 'looks_real', c.looks_real, 'face_match', c.face_match,
                 'summary', c.review_summary, 'created_at', c.created_at) end)
             order by m.updated_at)
        from public.institution_memberships m
        join public.profiles p on p.id = m.user_id
        left join public.institutions i on i.id = m.institution_id
        left join lateral (
          select * from public.student_id_checks s
           where s.user_id = m.user_id order by s.created_at desc limit 1) c on true
       where m.status = 'review'), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'nombre', r.nombre,
               'ciudad', r.ciudad,
               'sitio_web', r.sitio_web,
               'rol', r.rol,
               'created_at', r.created_at,
               'solicitante', p.nombre,
               'email', p.email,
               'membresia', m.status,
               'membresia_institucion', mi.nombre)
             order by r.created_at)
        from public.institution_requests r
        left join public.profiles p on p.id = r.user_id
        left join public.institution_memberships m on m.user_id = r.user_id
        left join public.institutions mi on mi.id = m.institution_id
       where r.estado = 'pendiente'), '[]'::jsonb),
    'institutions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'nombre', i.nombre, 'nombre_corto', i.nombre_corto,
               'ciudad', i.ciudad, 'activo', i.activo,
               'dominios', coalesce((select array_agg(d.dominio order by d.dominio)
                                       from public.institution_domains d where d.institution_id = i.id), '{}'))
             order by i.nombre)
        from public.institutions i), '[]'::jsonb),
    'stats', jsonb_build_object(
      'usuarios', (select count(*) from public.profiles),
      'nuevos_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
      'verificados', (select count(*) from public.institution_memberships where status = 'verified'),
      'plus_activos', (select count(*) from public.subscriptions s
                        where s.tier = 'plus' and s.status in ('active', 'trialing')
                          and (s.current_period_end is null or s.current_period_end > now())),
      'viajes_7d', (select count(*) from public.trips where created_at > now() - interval '7 days'))
  );
end $$;
revoke execute on function public.admin_panel() from public, anon;
grant execute on function public.admin_panel() to authenticated;

-- Aprobar o rechazar un carné en revisión (como review-core.mjs). Rechazar
-- deja un intento "retry" con el motivo, que la app le muestra a la persona.
-- Las imágenes las borra el panel después (política de arriba).
create or replace function public.admin_decide_membership(p_user uuid, p_approve boolean, p_reason text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  m public.institution_memberships;
  v_kind text;
begin
  if not private.is_admin() then raise exception 'NOT_ADMIN'; end if;
  select * into m from public.institution_memberships where user_id = p_user for update;
  if m.user_id is null then raise exception 'MEMBERSHIP_NOT_FOUND'; end if;
  if m.status <> 'review' then raise exception 'NOT_IN_REVIEW'; end if;
  select kind into v_kind from public.student_id_checks
   where user_id = p_user order by created_at desc limit 1;

  if p_approve then
    perform public.service_set_membership_status(p_user, 'verified',
      case when v_kind = 'document' then 'document' else 'student_card_photo' end);
    return 'verified';
  end if;

  if p_reason is null or p_reason not in ('unclear', 'mismatch', 'not_student') then
    raise exception 'INVALID_REASON';
  end if;
  perform public.service_set_membership_status(p_user, 'pending');
  insert into public.student_id_checks (user_id, institution_id, decision, kind, reasons)
  values (p_user, m.institution_id, 'retry', coalesce(v_kind, 'card_photo'),
          array['review_rejected', 'review_' || p_reason]);
  return 'pending';
end $$;
revoke execute on function public.admin_decide_membership(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_membership(uuid, boolean, text) to authenticated;

-- Solicitudes de institución: approve | merge | reject, igual que la herramienta de consola.
create or replace function public.admin_resolve_institution_request(
  p_request     uuid,
  p_action      text,
  p_nombre      text default null,
  p_dominios    text[] default '{}',
  p_institution uuid default null,
  p_motivo      text default null,
  p_tipo        public.community_type default 'universidad'
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_action = 'reject' and char_length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'REASON_REQUIRED';
  end if;
  return public.service_resolve_institution_request(
    p_request, p_action, p_nombre, p_dominios, p_institution, left(trim(p_motivo), 300), p_tipo);
end $$;
revoke execute on function public.admin_resolve_institution_request(uuid, text, text, text[], uuid, text, public.community_type) from public, anon;
grant execute on function public.admin_resolve_institution_request(uuid, text, text, text[], uuid, text, public.community_type) to authenticated;

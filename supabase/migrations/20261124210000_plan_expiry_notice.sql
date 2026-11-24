-- =====================================================================
-- ConVía — aviso de fin de ConVía+ para todos los planes con fecha de fin
--
-- Antes el aviso (3 días antes) y el paso a "expired" eran solo para los
-- pagos por transferencia. Ahora:
--  * Aviso 3 días antes para TODO ConVía+ que tenga fecha de fin (pago,
--    promoción de lanzamiento o activado a mano con fecha). Una sola vez por
--    periodo (dedupe = fecha de fin).
--  * Pasan a "expired" al vencer las de transferencia y las de la promoción.
--    Las activadas a mano siguen sin tocarse (el plan efectivo ya es el gratis
--    cuando vence la fecha).
--  * El texto no habla de renovar mientras los cobros estén apagados.
-- =====================================================================

create or replace function private.plus_payments_daily()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_expired integer;
  v_warned  integer;
  v_ready   boolean := private.payments_ready();
begin
  update public.subscriptions set status = 'expired'
   where provider in ('transferencia', 'promo_lanzamiento') and tier = 'plus' and status in ('active', 'trialing')
     and current_period_end is not null and current_period_end <= now();
  get diagnostics v_expired = row_count;

  insert into private.plus_pushes (user_id, kind, dedupe, title, body)
    select s.user_id, 'expiring', s.current_period_end::text, 'ConVía+',
           case
             when s.provider = 'promo_lanzamiento' then
               'Tu ConVía+ de regalo termina el ' || private.fecha_es(s.current_period_end)
               || '. Después sigues con el plan gratis, sin perder tus datos.'
             when v_ready then
               'Tu ConVía+ vence el ' || private.fecha_es(s.current_period_end)
               || '. No se renueva solo: si quieres seguir, renuévalo desde la app.'
             else
               'Tu ConVía+ vence el ' || private.fecha_es(s.current_period_end)
               || '. Después sigues con el plan gratis, sin perder tus datos.'
           end
      from public.subscriptions s
     where s.tier = 'plus' and s.status in ('active', 'trialing')
       and s.current_period_end > now() and s.current_period_end <= now() + interval '3 days'
  on conflict (user_id, kind, dedupe) do nothing;
  get diagnostics v_warned = row_count;

  -- Referencias nunca enviadas: 30 días. Registros decididos: 5 años. Comprobante: 30 días tras la decisión.
  delete from public.payment_requests where status = 'draft' and created_at < now() - interval '30 days';
  delete from public.payment_requests where status in ('granted', 'rejected') and decided_at < now() - interval '5 years';
  update public.payment_requests set receipt_path = null
   where receipt_path is not null and decided_at < now() - interval '30 days';
  delete from private.plus_pushes where created_at < now() - interval '30 days';

  if v_warned > 0 then perform private.dispatch_pending_pushes(); end if;
  return jsonb_build_object('expired', v_expired, 'warned', v_warned);
end $$;
revoke execute on function private.plus_payments_daily() from public, anon, authenticated;

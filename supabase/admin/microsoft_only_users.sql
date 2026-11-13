-- =====================================================================
-- ConVía — cuentas que solo tienen identidad de Microsoft (azure)
--
-- Solo lectura. SQL Editor del proyecto (rol postgres). Devuelve conteos, sin
-- correos ni nombres: compartir el resultado no expone a nadie.
-- Contexto: el inicio de sesión con Microsoft se retiró de la app
-- (docs/OPERACION.md §5). Estas personas entran con "¿Olvidaste tu
-- contraseña?" y el mismo correo, que les crea una contraseña.
-- =====================================================================
select
  count(*) filter (where ids.has_azure and not ids.has_other)                          as solo_microsoft,
  count(*) filter (where ids.has_azure and not ids.has_other and u.email is null)      as solo_microsoft_sin_correo,
  count(*) filter (where ids.has_azure and ids.has_other)                              as microsoft_y_correo,
  count(*)                                                                             as cuentas_totales
from auth.users u
cross join lateral (
  select coalesce(bool_or(i.provider = 'azure'), false)  as has_azure,
         coalesce(bool_or(i.provider <> 'azure'), false) as has_other
    from auth.identities i where i.user_id = u.id
) ids;

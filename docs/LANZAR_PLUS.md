# Lanzar ConVía+ de pago (transferencia Bre-B)

Pasos exactos para encender el pago de ConVía+. Cómo funciona: `docs/PLANES.md` →
«Pago por transferencia». Todo queda construido y apagado desde la migración 047
(PR `feat/plus-payments`). Este lanzamiento es el PR `launch/plus-payments`:
migraciones 048 (documentos legales 1.4) y 049 (`payments_enabled = true`).

> **Nunca** pongas la llave Bre-B, el nombre ni el documento del titular en el
> repositorio, en un issue o en un PR. La llave y el titular viven solo en
> `app_config` de producción (paso 3). El nombre, el documento y la ciudad del
> vendedor sí se publican en los Términos (paso 1), porque la ley lo exige.

## 0. Antes de empezar

- [ ] El PR `feat/plus-payments` (047) está en `main`, aplicado en producción
      (`npx supabase db push`) y con `notify`, `card-review-cleanup` y
      `delete-account` desplegadas. Si no, los pasos 5 y 6 lo hacen todo junto.
- [ ] Tu cuenta está en `private.admins` (recibe el aviso «N pagos por revisar»).
      Compruébalo en el SQL Editor: `select count(*) from private.admins;`
- [ ] `scripts/admin/.env.review.local` tiene `SUPABASE_URL` y
      `SUPABASE_SERVICE_ROLE_KEY` de producción (no se imprimen nunca).
- [ ] Recomendado: que un abogado revise los Términos y la Política 1.4 antes de cobrar.

## 1. Completar el vendedor en los Términos (rama `launch/plus-payments`)

En `src/content/legal.ts` → `LEGAL_COMPANY.seller`, cambia:

| Marcador | Qué va |
| --- | --- |
| `[NOMBRE]` | nombre completo de quien vende y recibe los pagos (o razón social) |
| `[CC/NIT]` | `C.C. 1.234.567.890` (persona) o `NIT 900.123.456-7` (empresa) |
| `[CIUDAD]` | ciudad del domicilio (sin dirección) |

Pon también `LEGAL_UPDATED_AT` con la fecha del lanzamiento. Comprueba que no
quede ningún marcador:

```bash
grep -rn "\[NOMBRE\]\|\[CC/NIT\]\|\[CIUDAD\]" src web-landing
# No debe imprimir nada.
```

El titular de la llave Bre-B (paso 3) debe ser **la misma persona** que pusiste en `[NOMBRE]`.

Si cambiaste los precios (12 000 / 108 000), cámbialos también en la sección 8 de
los Términos, en `web-landing/index.html` (planes y la pregunta «¿Cómo pago ConVía+?»)
y en `plus_prices` (paso 3). Luego:

```bash
npx tsc --noEmit && npx expo lint && npm test
git commit -am "chore(legal): vendedor de ConVía+" && git push
```

## 2. Revisar el PR

En GitHub, PR `launch/plus-payments` → que CI esté en verde → **Ready for review**.
Todavía no lo fusiones.

## 3. Llave y titular en producción (SQL Editor, rol postgres)

Solo funciona si la 047 ya está aplicada. Con `payments_enabled = false` esto no
cambia nada para la gente; la migración 049 lo enciende en el paso 5.

```sql
update public.app_config
   set bre_b_key  = '<LLAVE_BRE_B>',      -- p. ej. la llave tipo celular, correo o alfanumérica, tal como la da tu banco
       payee_name = '<TITULAR>'           -- el nombre que verá la persona al transferir; igual a [NOMBRE]
 where id;

-- Precios (solo si cambian; en pesos, impuestos incluidos):
-- update public.plus_prices set amount_cop = 12000  where period = 'monthly';
-- update public.plus_prices set amount_cop = 108000 where period = 'yearly';

-- Comprobar sin mostrar la llave:
select payments_enabled, bre_b_key is not null as tiene_llave, payee_name is not null as tiene_titular
  from public.app_config;
select period, months, amount_cop from public.plus_prices order by months;
```

No pegues el resultado con la llave en ningún sitio público.

## 4. Fusionar el PR B

Merge de `launch/plus-payments` en `main`. El push a `main` vuelve a publicar la web
(GitHub Pages: landing con precios y la app web) de forma automática.

## 5. Aplicar las migraciones en producción

```bash
git checkout main && git pull
npx supabase migration list          # deben salir pendientes 048 y 049 (y 047 si no se aplicó)
npx supabase db push
```

Desde este momento la app muestra el pago en la pantalla ConVía+ (web al instante;
el APK instalado también, porque el componente ya venía en la 047), y quien aceptó
la versión 1.3 ve el aviso para aceptar los documentos 1.4.

Comprobar (SQL Editor):

```sql
select payments_enabled from public.app_config;                       -- true
select private.current_legal_version();                               -- 1.4
select jobname, schedule, active from cron.job where jobname = 'plus-payments-daily';
```

## 6. Desplegar las funciones

```bash
npx supabase functions deploy notify card-review-cleanup delete-account
```

(`notify` envía los avisos de pagos; `card-review-cleanup` borra los comprobantes a
los 30 días; `delete-account` borra los comprobantes con la cuenta.)

## 7. Compilar el APK

```bash
# Opcional: quitar la variable vieja de Microsoft del entorno de EAS si existe.
npx eas-cli@latest env:list --environment preview
# npx eas-cli@latest env:delete --environment preview --variable-name EXPO_PUBLIC_MICROSOFT_AUTH

npx eas-cli@latest build --platform android --profile preview
```

Al terminar, copia el enlace de descarga del APK desde la página del build en expo.dev.

## 8. Publicar el APK

GitHub → Actions → **Publicar APK** → *Run workflow*:

- `apk_url`: el enlace del paso 7
- `version`: la siguiente (p. ej. `1.0.0-beta.N`)
- `notes`: `ConVía+ de pago por transferencia. Documentos legales 1.4. Se retira el inicio de sesión con Microsoft.`

La landing (`…/releases/latest/download/convia.apk`) sirve el APK nuevo enseguida.

## 9. Prueba real (con tu cuenta)

1. En la app: Perfil → ConVía+ → Mensual → **Continuar**. Anota la referencia.
2. Transfiere $12.000 por Bre-B con esa referencia en la descripción → **Ya pagué**.
3. Te llega «1 pago por revisar». En la computadora:
   ```bash
   npm run plus -- --list
   npm run plus -- --grant CV-XXXX
   ```
4. Te llega «ConVía+ activo hasta el …» y la app muestra ConVía+.
5. Si quieres dejarlo limpio, hazte el reembolso y vuelve a gratis:
   `update public.subscriptions set status = 'canceled' where user_id = '<tu uuid>';`

## Operación diaria

- Cada aviso de pago: busca la referencia en los movimientos del banco y revisa el valor.
  - Llegó bien → `npm run plus -- --grant CV-XXXX` (si llegó otro valor: `--amount 10000`;
    si llegó otro día: `--paid-on AAAA-MM-DD`).
  - No llegó o no coincide → `npm run plus -- --reject CV-XXXX --reason "No encontramos la transferencia"`
    (la persona ve el motivo).
  - Plazo prometido: **24 horas hábiles** desde el aviso.
- Retracto (5 días hábiles desde la activación): devuelve el 100 % en máximo 30 días
  calendario y baja el plan:
  `update public.subscriptions set status = 'canceled' where user_id = (select user_id from public.payment_requests where reference = 'CV-XXXX');`
- Los registros de pago se guardan 5 años (`payment_requests`, también para la
  contabilidad); los comprobantes se borran solos 30 días después de la decisión.

## Apagar (sin perder datos)

```sql
update public.app_config set payments_enabled = false where id;
```

La pantalla vuelve a «Muy pronto» y todas las RPC de pago responden
`PAYMENTS_DISABLED`. Las suscripciones ya activas siguen hasta su fecha.

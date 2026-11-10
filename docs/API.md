# ConVía server API

Everything the app (or the database) can call on the server: Edge Functions,
public RPCs, scheduled jobs and webhooks. Generated from `supabase/functions/*/index.ts`,
`supabase/config.toml` and `supabase/migrations/` on 2026-11-10; when you change a
function's contract, update its section in the same PR.

Data model: [DER.md](DER.md). Secrets, Vault entries and operating the jobs:
[OPERACION.md §8](OPERACION.md#8-funciones-de-ia-secretos-y-trabajos-programados).

## Conventions shared by every Edge Function

| | |
| --- | --- |
| URL | `https://<project-ref>.supabase.co/functions/v1/<name>` (the app uses `supabase.functions.invoke`) |
| Method | `POST` only; `OPTIONS` answers the CORS preflight (except `card-review-cleanup`, which has no CORS); anything else → `405 METHOD_NOT_ALLOWED` |
| Gateway auth | `verify_jwt = true` for all of them (`config.toml`; `match-agent` uses the default, also `true`): a request without a valid Supabase JWT (user session or anon key) never reaches the code |
| User auth | `Authorization: Bearer <user access token>`, checked again in the function with `auth.getUser()`; the user always comes from the token, never from the body → `401 AUTH_REQUIRED` |
| Cron auth | Scheduled jobs send the anon key as JWT plus `x-convia-cron: <CRON_SECRET>`; a wrong or missing secret → `401 AUTH_REQUIRED` |
| Body | JSON object, read with a byte cap (`readJsonBody`): over the cap → `413 PAYLOAD_TOO_LARGE`; not a JSON object → `400 INVALID_BODY` |
| Errors | `{ "error": "<CODE>" }` with codes, never user-facing text; the app translates them (`errorMessage()`) |
| AI functions | Without `MODEL_API_KEY` → `503 MODEL_UNAVAILABLE` (unless `ALLOW_MOCK=true`, never in production; responses then carry `mock: true`). They require accepted legal version ≥ 1.2 → `403 LEGAL_OUTDATED` (`500 LEGAL_CHECK_FAILED` if the check itself fails) |
| Plan checks | `service_check_plan` decides: `403 CAPACIDAD_PLAN:<capability>` or `403 LIMITE_PLAN:<limit>:<max>`; `500 PLAN_CHECK_FAILED` on any other error |
| Logs | One JSON line per event (`{ fn, event, … }`), never names, plates or images |

## Edge Functions

### `notify`

Push notifications through Expo. Recipients are always derived on the server from the
stored rows, so a client cannot notify arbitrary users.

- **Auth:** user JWT for every event except `sweep`, which needs `x-convia-cron`.
- **Input:** `{ "event": <event>, "id": "<uuid>" }` (≤ 1 MB). `id` is required except for `sweep`.

| `event` | `id` is | Sends when | To |
| --- | --- | --- | --- |
| `request_created` | `trip_requests.id` | caller is the passenger and the request is `pendiente` | driver |
| `request_cancelled` | `trip_requests.id` | caller is the passenger and the request is `cancelado` | driver |
| `request_responded` | `trip_requests.id` | caller is the trip's driver and the state is `aceptado`/`negado` | passenger (once per state) |
| `message` | `messages.id` | caller is the sender | driver + accepted/boarded passengers, except the sender |
| `trip_updated` | `trip_updates.id` | caller is the driver who wrote it (`update_trip`, `cancel_trip`, `finish_trip`) | the row's `recipients`, or the accepted passengers |
| `trip_published` | `trips.id` | caller is the driver | trip alerts claimed by `claim_alert_pushes` |
| `recurring_saved` | `recurring_trips.id` | caller is the driver | alerts claimed for that schedule |
| `sweep` | — | cron only | pending alerts, recurring-trip notices (`claim_recurring_pushes`) and admin review notices (`claim_admin_review_pushes`) |

- **Output:** `200 { "sent": <number of Expo messages> }`; `sent: 0` when the caller isn't
  allowed or nobody has a push token / notifications enabled.
- **Errors:** `400 EVENT_REQUIRED`, `401 AUTH_REQUIRED`, `413 PAYLOAD_TOO_LARGE`, `500 NOTIFY_FAILED`.
- **Limits:** each `(event, id)` (or `id:estado` for answers) is sent once (`notified_events`,
  kept 30 days). Who gets an alert (compatibility, organization, preferences, daily cap) is decided in the database.

### `delete-account`

Deletes the caller's account: files in `avatars`, `vehicle-photos` and
`face-verifications` (`<user_id>/…`), then the auth user; every table row cascades from `auth.users`.

- **Auth:** user JWT. **Input:** none (the body is ignored).
- **Output:** `200 { "deleted": true }`.
- **Errors:** `401 AUTH_REQUIRED`, `409 ACTIVE_TRIP` (the caller drives a trip `en_curso`), `500 DELETE_FAILED`.
- **Limits:** up to 1 000 files per bucket folder.

### `verify-vehicle`

SAM 3.1 finds the car and plate in a photo; Muse Spark 1.3 reads plate, brand and color and
they are compared with the registered vehicle. The result is stored in `vehicle_verifications`.

- **Auth:** user JWT (driver). AI rules apply (legal 1.2, `MODEL_API_KEY`). Free for every plan.
- **Input (≤ 1 MB):** `{ "vehicle_id": "<uuid>", "photo_path": "<user_id>/verify-<id>.(jpg|jpeg|png|webp)" }` —
  a photo the caller uploaded to `vehicle-photos`. `mock_outcome` is honored only in mock mode.
- **Output (200):** `{ status: "verified"|"failed"|"retry", reason, message, plate_read, confidence, verified_at, mock }`.
  `reason` includes `unsupported_plate` (motorcycle plates), `too_many_attempts`, `timeout`,
  `rate_limited`, `service_unavailable`, `bad_model_response`, `save_failed`, `server_error`.
  Model and server failures come back as `200` with `status: "retry"`.
- **Errors:** `400 INVALID_BODY` (path not in the caller's folder or bad name), `404 VEHICLE_NOT_FOUND`
  (missing, someone else's or inactive), `404 PHOTO_NOT_FOUND`, plus the shared ones.
- **Limits:** 10 attempts per driver per hour (fixed) and `VERIFY_VEHICLE_MAX_PER_DAY` (default 20) per 24 h.

### `suggest-vehicle`

Muse Spark proposes brand, line, color and plate from a photo to prefill the vehicle form.
Nothing is stored.

- **Auth:** user JWT; ConVía+ capability `vehicle_autofill`. AI rules apply.
- **Input (≤ 4 MB):** `{ "image": "data:image/(jpeg|png|webp);base64,…" }` (≤ 3 000 000 characters).
- **Output (200):** `{ status: "ok", suggestion: { brand, line, color, plate }, mock }` (any field may be `null`)
  or `{ status: "unclear", reason: "no_vehicle"|"not_a_real_vehicle"|"nothing_certain", mock }`
  or `{ status: "retry", reason, mock }` with `reason` `too_many_attempts`, a model error kind or `server_error`.
- **Errors:** `400 INVALID_BODY`, `403 CAPACIDAD_PLAN:vehicle_autofill`, plus the shared ones.
- **Limits:** 20 per user per hour, counted in `vehicle_suggestions` across instances.

### `verify-pickup`

The passenger films ≤ 2 s of the arriving car; the frames go to the model and the plate,
brand and color are compared with the trip's vehicle. Clip and frames are deleted from
`pickup-clips` when the check ends. The attempt is recorded in `pickup_verifications`
before the paid call.

- **Auth:** user JWT (passenger of an **accepted** request on a trip `por_empezar`/`en_curso`). AI rules apply.
  With an `x-convia-cron` header the request is instead the cleanup job (below).
- **Input (≤ 1 MB):**
  ```json
  { "request_id": "<trip_requests.id>",
    "clip_path": "<user_id>/<request_id>/clip-<id>.(mp4|mov)",
    "frames": [{ "path": "<user_id>/<request_id>/frame-<id>-<n>.jpg", "time_ms": 0, "width": 720, "height": 1280 }] }
  ```
  1–16 frames, `0 ≤ time_ms ≤ 10 000`, `16 ≤ width/height ≤ 8 000`; every path in the caller's folder for that request.
- **Output:** with `Accept: application/x-ndjson`, a stream of `{ "type": "progress", "step": … }` lines and a final
  `{ "type": "result", "status": <http status>, "body": {…} }`; otherwise one JSON body. The body:
  `{ verification_id, status, reason, plate_read, confidence, brand_match, color_match, brand_read, color_read,
  vehicle: { plate, brand, color }, driver: { name, phone }, mock }`. `too_many_attempts` and server errors come back
  as `status: "retry"`.
- **Errors:** `400 INVALID_BODY`, `404 REQUEST_NOT_FOUND` (missing or someone else's), `409 REQUEST_NOT_ACCEPTED`,
  `422 UNSUPPORTED_VEHICLE` (motorcycle plate), `403 CAPACIDAD_PLAN:pickup_verification` / `LIMITE_PLAN:pickup_verifications_month:<n>`,
  plus the shared ones.
- **Limits:** plan limit `pickup_verifications_month` (Free 10/month, ConVía+ unlimited; the beta does not relax it);
  `PICKUP_MAX_ATTEMPTS` (6) per request, `PICKUP_MAX_PER_USER_DAY` (30) per passenger per 24 h,
  `PICKUP_MAX_TOTAL_DAY` (1 000) overall per 24 h.
- **Cleanup mode (cron `cleanup-pickup-clips`):** header `x-convia-cron`, no body needed. Deletes clips and frames older
  than 1 hour (`service_stale_pickup_clips`, up to 5 × 1 000 files per run). `200 { "removed": n }`, `500 CLEANUP_FAILED`.

### `verify-student-id`

Student card check for the institution the user chose. Two modes:

- **Card with photo** (default): the phone sends only crops without the face. Muse Spark reads them and
  `decide.ts` compares name, institution, expiry and the on-device face match → `verified`, `review` or `retry`.
- **Document** (`mode: "document"`): a card without photo plus a screenshot of the student account. It is never
  verified automatically: `review` (a person approves it, `private.approve_membership`) or `retry`.

Images for `review` are kept in `face-verifications/<user_id>/student-card-review-*` for 7 days
(`card-review-cleanup`); every check is a row in `student_id_checks`.

- **Auth:** user JWT. AI rules apply (`MODEL_API_KEY` is checked only once an image must be read). Free.
- **Input (≤ 10 MB):** `{ "crops": ["<base64 jpeg>", …] }` (0–4 crops) or
  `{ "mode": "document", "card": "<base64>", "screenshot": "<base64>" }`; each image ≤ 2 000 000 base64 characters.
- **Output (200):** `{ "decision": "verified"|"review"|"retry", "reasons": ["<code>", …] }` (no crops → `retry`, `face_not_found`).
- **Errors:** `400 INVALID_BODY`, `409 NO_INSTITUTION_CHOSEN`, `409 ALREADY_VERIFIED`, `429 TOO_MANY_ATTEMPTS`,
  `404 NOT_FOUND`, `502 CHECK_FAILED`, plus the shared ones.
- **Limits:** `STUDENT_ID_MAX_PER_DAY` (default 5) per user per 24 h.

### `card-review-cleanup`

Deletes student-card review images older than 7 days (`service_expired_card_review_files`).

- **Auth:** cron only (`x-convia-cron`, constant-time comparison); refuses any other call. No CORS.
- **Input:** none. **Output:** `200 { "removed": n }`.
- **Errors:** `401 AUTH_REQUIRED`, `405 METHOD_NOT_ALLOWED`, `500 CLEANUP_FAILED`.

### `match-agent`

Trip assistant: Muse Spark with tools that read with the user's own session (RLS), plus a
second call that judges the proposal. Runs and steps are traced in `agent_runs` / `agent_steps`.

- **Auth:** user JWT; ConVía+ capability `trip_assistant`. AI rules apply (`LLM_*` config instead of `MODE`).
- **Run — `POST /match-agent`:** `{ "message": "<1–1 000 chars>", "language": "es"|"en" }`.
  Requires a **verified** institution membership. Answers NDJSON: `{ "type": "progress", "step", "status" }` lines
  and a final `{ "type": "result", run_id, status, reply, spec, options, proposal, error }` where `proposal` is
  `{ hash, trip_id, seats, price_cop, departure, pickup, dropoff }` or `null`.
- **Confirm — `POST /match-agent/confirm`:** `{ "run_id": "<uuid>", "proposal_hash": "<hash>" }`. Creates the trip
  request with the user's session (the database still checks face check, seats, institution and the 90-minute rule);
  each proposal can be used once. `200 { ok: true, request_id }` or `409 { ok: false, error: <code>, detail }`.
- **Errors:** `400 INVALID_BODY`, `403 INSTITUTION_NOT_VERIFIED`, `403 CAPACIDAD_PLAN:trip_assistant`,
  `429 TOO_MANY_ATTEMPTS`, `500 RUN_NOT_CREATED`; a failed run ends with `status: "failed"`, `error: "RUN_FAILED"`.
- **Limits:** `AGENT_RUNS_PER_DAY` (default 30) runs per user per 24 h. The body has no byte cap beyond the
  platform's; only `message` length is checked.

## Public RPCs (PostgREST)

Called with `supabase.rpc('<name>', { p_…: … })`, i.e. `POST /rest/v1/rpc/<name>` with the
user's JWT. Every function below is `SECURITY DEFINER` with `search_path = ''` and reads the
caller from `auth.uid()`, never from an argument. Effective `EXECUTE` grants were computed
from the migrations (Postgres/Supabase defaults, then every `grant`/`revoke` in order).

**Errors:** the function raises an exception (PostgREST answers `400` with the text in
`message`, SQLSTATE `P0001`). Newer functions raise codes (`AUTH_REQUIRED`,
`CAPACIDAD_PLAN:<capability>`, `LIMITE_PLAN:<limit>:<max>`, `INSTITUTION_NOT_FOUND`,
`ALREADY_VERIFIED`, `REQUEST_PENDING`, `LEGAL_VERSION_INVALID`…); older ones raise a short
Spanish sentence. The app maps both through `errorMessage()`; plan codes become the upgrade prompt.

### Callable by signed-in users (`authenticated`)

| RPC | Arguments | Returns | What it does / main errors |
| --- | --- | --- | --- |
| `get_my_profile` | — | `jsonb` | The caller's profile, roles and verification state |
| `get_my_plan` | — | table (`tier`, `name`, `status`, `current_period_end`, `limits`, `features`, `plan_limits`, `capabilities`, `beta_mode`) | Effective plan; screens ask `usePlan().can()/limit()` from it ([PLANES.md](PLANES.md)) |
| `switch_role` | `p_rol user_role` | `profiles` | Switch passenger ↔ driver; refused during a trip `en_curso` |
| `accept_legal` | `p_version text` | `text` | Records acceptance of the legal documents (`LEGAL_VERSION_INVALID`, `PROFILE_NOT_FOUND`) |
| `my_accepted_legal_version` | — | `text` | Version the caller accepted (the AI functions require ≥ 1.2) |
| `submit_face_embedding` | `p_embedding real[]`, `p_purpose text = 'register'` | `jsonb` | On-device face embedding: register the selfie or check it against it |
| `submit_license_face` | `p_embedding real[]` | `jsonb` | Face on the driver's licence vs. the selfie (driver identity) |
| `submit_student_card_face` | `p_embedding real[]` | `jsonb` | Face on the student card vs. the selfie (feeds `verify-student-id`) |
| `search_institutions` | `p_query text` | table (`id`, `nombre`, `nombre_corto`, `ciudad`) | Institution picker |
| `choose_institution` | `p_institution_id uuid` | `void` | Sets the caller's institution membership (`INSTITUTION_NOT_FOUND`, `ALREADY_VERIFIED`) |
| `request_institution` | `p_nombre`, `p_ciudad`, `p_sitio_web`, `p_rol` (`text`) | `void` | Asks admins to add an institution (`REQUEST_PENDING`) |
| `my_institution` | — | `jsonb` | Membership, institution, last request and last card check |
| `current_institution_id` | — | `uuid` | Caller's institution (also used by RLS) |
| `start_trip` / `finish_trip` / `cancel_trip` | `p_trip_id uuid` | `trips` / `jsonb` / `jsonb` | Driver moves the trip through its states; finish/cancel write a `trip_updates` row for `notify` |
| `update_trip` | trip id, vehicle, origin/destination name + lat/lng, `p_salida_at`, `p_precio`, `p_cupos_totales`, `p_descripcion`, `p_ruta jsonb = null` | `jsonb` | Driver edits a trip that hasn't started; accepted passengers are notified (`trip_updated`) |
| `respond_trip_request` | `p_request_id uuid`, `p_accept boolean` | `trip_requests` | Driver accepts/rejects; checks seats, driver identity, the 90-minute rule and ConVía+ priority |
| `cancel_trip_request` | `p_request_id uuid` | `trip_requests` | Passenger cancels their request |
| `board_passenger` | `p_qr_token uuid` | `trip_requests` | Driver scans the passenger's QR → `abordado` |
| `set_passenger_payment` | `p_request_id uuid`, `p_paid boolean` | `void` | Driver marks a passenger's payment |
| `report_pickup_mismatch` | `p_verification_id uuid` | `void` | Passenger reports that the car didn't match (`pickup_report_not_allowed`) |
| `driver_trip_requests` | — | table | Requests on the driver's trips, with match score and pickup/drop-off distance |
| `my_trip_requests` | — | table | The passenger's requests with trip summary and last changes |
| `passenger_trip_history` | — | table | Past trips of the passenger, with driver rating and own score |
| `my_trip_stats` | — | `jsonb` | Trip counters for the profile screen |
| `trip_members` | `p_trip_id uuid` | `jsonb` | Driver and accepted passengers; members only |
| `seats_taken` | `p_trip_id uuid` | `integer` | Accepted/boarded seats |
| `is_trip_driver` / `is_trip_passenger` | `p_trip_id uuid` | `boolean` | Membership helpers (also used by RLS) |
| `my_chat_trips` | — | table | Trips whose chat the caller can open |
| `chat_trip_state` | `p_trip_id uuid` | `text` | `open`, `ended` or `none` for the chat screen |
| `rate_trip_driver` | `p_trip_id uuid`, `p_score smallint`, `p_comment text = null` | `void` | Passenger rates the driver of a finished trip (1–5, ≤ 500 chars, once) |
| `rate_trip_passenger` | `p_request_id uuid`, `p_score smallint`, `p_comment text = null` | `void` | Driver rates a passenger (1–5, ≤ 500 chars) |
| `save_recurring_trip` | schedule fields (`p_hora`, `p_dias smallint[]`, `p_fecha_inicio/fin`, route, price, seats…) | `jsonb` | ConVía+ `recurring_trips`; max 10 active schedules |
| `set_recurring_trip_active` | `p_id uuid`, `p_active boolean` | `jsonb` | Pause/resume a schedule (`CAPACIDAD_PLAN:recurring_trips`) |
| `delete_recurring_trip` | `p_id uuid` | `jsonb` | Delete a schedule |

### Callable without a session (`anon` and `authenticated`)

| RPC | Arguments | Returns | What it does |
| --- | --- | --- | --- |
| `check_email_domain` | `p_email text` | table (`institution_id`, `nombre`, `tipo`, `dominio`) | Sign-up: is the email domain an allowed institution? |

### Service role only (Edge Functions and jobs)

`service_check_plan`, `service_accepted_legal_version`, `service_set_membership_status`,
`service_resolve_institution_request`, `service_expired_card_review_files`,
`service_stale_pickup_clips`, `claim_alert_pushes`, `claim_recurring_pushes`,
`claim_admin_review_pushes`, `set_verification_result`. They are not reachable with a user
JWT. Trigger functions (`handle_new_user`, `trips_before_insert`, `trip_requests_before_insert`,
`saved_places_limit`, `refresh_rating`…) can't be called as RPCs. Functions in the `private`
schema are not exposed by PostgREST.

### Views

`available_trips` (`security_invoker`, RLS of the caller): trips a passenger can request, with
the driver's public data and ConVía+ badge.

## Scheduled jobs (`pg_cron`)

All times UTC. Jobs that call a function use `pg_net` with the Vault secrets
`convia_project_url`, `convia_anon_key` and `convia_cron_secret`; without them they do nothing.

| Job | Schedule | Runs | Calls | Migration |
| --- | --- | --- | --- | --- |
| `dispatch-pending-pushes` | `*/5 * * * *` | `private.dispatch_pending_pushes()` | `notify` (`sweep`), only when something is pending | 025 |
| `mark-unstarted-trips` | `*/10 * * * *` | `private.mark_unstarted_trips()` | — | 015 |
| `generate-recurring-trips` | `7 * * * *` | `private.generate_recurring_trips()` | — | 025 |
| `cleanup-logs` | `17 3 * * *` | deletes `cron.job_run_details` older than 7 days | — | 027 |
| `cleanup-alert-hits` | `23 3 * * *` | deletes `trip_alert_hits` of trips that left more than 30 days ago | — | 027 |
| `cleanup-notified-events` | `29 3 * * *` | deletes `notified_events` older than 30 days | — | 030 |
| `cleanup-vehicle-suggestions` | `31 3 * * *` | deletes `vehicle_suggestions` older than 1 day | — | 032 |
| `cleanup-pickup-clips` | `*/30 * * * *` | `private.dispatch_pickup_clips_cleanup()` | `verify-pickup` (cleanup mode) | 033 |
| `cleanup-card-review-files` | `41 3 * * *` | `private.dispatch_card_review_cleanup()` | `card-review-cleanup` | 038 |
| `admin-review-alerts` | `0 12,22 * * *` | `private.enqueue_admin_review_pushes()` (one notice per admin per day at most) | sent by the next `dispatch-pending-pushes` | 041 |

## Webhooks

There are **no inbound webhooks** today: no Database Webhooks (`supabase_functions.hooks`),
no Auth Hooks in `config.toml` and no payment provider callbacks. The only server-to-server
HTTP calls are the outbound `pg_net` requests of the jobs above. `subscriptions` is
writable only by the service role so a future payments webhook can own it (migration 019).

-- =====================================================================
-- ConVía — esquema inicial
-- Carpooling para comunidades cerradas (universidad / empresa)
-- Roles: usuario (pasajero) y conductor
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------
create type public.user_role           as enum ('usuario', 'conductor');
create type public.community_type      as enum ('universidad', 'empresa');
create type public.trip_status         as enum ('por_empezar', 'en_curso', 'finalizado', 'cancelado');
create type public.request_status      as enum ('pendiente', 'aceptado', 'negado', 'abordado', 'cancelado');
create type public.verification_status as enum ('pendiente', 'procesando', 'verificado', 'fallido');
create type public.message_author      as enum ('usuario', 'asistente');

-- ---------------------------------------------------------------------
-- 2. TABLAS
-- ---------------------------------------------------------------------

-- Instituciones permitidas (validación por dominio del correo)
create table public.institutions (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  tipo        public.community_type not null,
  dominio     text not null unique check (dominio = lower(dominio)),
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Perfil de cada usuario (1:1 con auth.users)
create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  nombre               text not null default '',
  email                text not null,
  institution_id       uuid references public.institutions(id),
  rol                  public.user_role not null default 'usuario',
  avatar_url           text,
  telefono             text,
  rating_avg           numeric(3,2) not null default 0,
  rating_count         integer not null default 0,
  verification_status  public.verification_status not null default 'pendiente',
  verified_at          timestamptz,
  terms_accepted_at    timestamptz,
  onboarding_completed boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index profiles_institution_idx on public.profiles(institution_id);

-- Vehículos de los conductores
create table public.vehicles (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null references public.profiles(id) on delete cascade,
  placa       text not null unique check (placa = upper(placa)),
  marca       text not null,
  color       text not null,
  puestos     smallint not null check (puestos between 1 and 8),
  foto_url    text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index vehicles_driver_idx on public.vehicles(driver_id);

-- Viajes publicados por conductores
create table public.trips (
  id              uuid primary key default gen_random_uuid(),
  driver_id       uuid not null references public.profiles(id) on delete cascade,
  vehicle_id      uuid not null references public.vehicles(id),
  institution_id  uuid references public.institutions(id),
  origen_nombre   text not null,
  origen_lat      double precision,
  origen_lng      double precision,
  destino_nombre  text not null,
  destino_lat     double precision,
  destino_lng     double precision,
  sector          text,
  salida_at       timestamptz not null,
  precio          numeric(10,2) not null check (precio >= 0),
  cupos_totales   smallint not null check (cupos_totales between 1 and 8),
  descripcion     text,
  estado          public.trip_status not null default 'por_empezar',
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index trips_driver_idx      on public.trips(driver_id);
create index trips_estado_salida   on public.trips(estado, salida_at);
create index trips_institution_idx on public.trips(institution_id);

-- Puntos solicitados por pasajeros (solicitudes)
create table public.trip_requests (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips(id) on delete cascade,
  passenger_id  uuid not null references public.profiles(id) on delete cascade,
  direccion     text not null,
  lat           double precision,
  lng           double precision,
  hora_aprox    timestamptz,
  estado        public.request_status not null default 'pendiente',
  qr_token      uuid not null unique default gen_random_uuid(),
  responded_at  timestamptz,
  boarded_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (trip_id, passenger_id)
);
create index trip_requests_passenger_idx on public.trip_requests(passenger_id);
create index trip_requests_trip_idx      on public.trip_requests(trip_id, estado);

-- Ubicación en vivo del conductor durante el viaje
create table public.trip_locations (
  trip_id     uuid primary key references public.trips(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  heading     double precision,
  eta_next_stop_seconds integer,
  updated_at  timestamptz not null default now()
);

-- Calificaciones entre participantes de un viaje
create table public.ratings (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  rater_id    uuid not null references public.profiles(id) on delete cascade,
  rated_id    uuid not null references public.profiles(id) on delete cascade,
  score       smallint not null check (score between 1 and 5),
  comentario  text,
  created_at  timestamptz not null default now(),
  unique (trip_id, rater_id, rated_id),
  check (rater_id <> rated_id)
);
create index ratings_rated_idx on public.ratings(rated_id);

-- Chat con el asistente virtual
create table public.assistant_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  trip_id     uuid references public.trips(id) on delete set null,
  autor       public.message_author not null,
  contenido   text not null,
  created_at  timestamptz not null default now()
);
create index assistant_messages_user_idx on public.assistant_messages(user_id, created_at);

-- Búsquedas recientes
create table public.recent_searches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  texto       text not null,
  created_at  timestamptz not null default now()
);
create index recent_searches_user_idx on public.recent_searches(user_id, created_at desc);

-- Verificación facial (arquitectura preparada; el proveedor se conecta después)
create table public.face_verifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  selfie_path text,
  status      public.verification_status not null default 'procesando',
  provider    text,
  score       numeric(5,4),
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index face_verifications_user_idx on public.face_verifications(user_id, created_at desc);

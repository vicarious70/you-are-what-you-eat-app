-- You Are What You Eat — Health DNA Engine: Supabase schema.
--
-- Run this in the Supabase SQL editor (or `supabase db push`). It is the
-- persistence layer behind the engine: one row per profile, meal, activity,
-- body reading, and cached weekly review. Row Level Security ensures each
-- authenticated user only ever touches their own rows.
--
-- The engine itself stays pure JS; lib/dna-store.mjs maps these rows to and
-- from the shapes in engine/schema.js.

-- Required for gen_random_uuid().
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles — the durable Health DNA profile (1:1 with an auth user)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  name                  text        not null default 'Friend',
  sex                   text        not null default 'unspecified'
                          check (sex in ('female', 'male', 'unspecified')),
  age                   int,
  height_in             numeric,
  start_weight_lb       numeric,
  goal                  text        not null default 'General wellness',
  activity_level        text        not null default 'Moderate activity',
  medical_conditions    text[]      not null default '{}',
  mobility_limitations  text[]      not null default '{}',
  pregnancy_status      text        not null default 'none'
                          check (pregnancy_status in ('none', 'pregnant', 'postpartum')),
  food_preferences      text[]      not null default '{}',
  budget_limited        boolean     not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- meals — what was served, plus context and post-meal signals
-- Nutrition columns describe the SERVED plate; eaten_fraction drives
-- Consumption DNA in the engine.
-- ---------------------------------------------------------------------------
create table if not exists public.meals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users (id) on delete cascade,
  at              timestamptz not null default now(),
  meal_type       text        not null default 'Home plate',
  portion         text        not null default 'Standard',
  timing          text        not null default 'Lunch',
  hunger          text        not null default 'Hungry',
  eaten_amount    text        not null default 'All or planned',
  eaten_fraction  numeric     not null default 1,
  notes           text        not null default '',
  foods           jsonb       not null default '[]',
  tags            text[]      not null default '{}',
  -- served nutrition
  calories        int         not null default 650,
  calorie_min     int         not null default 520,
  calorie_max     int         not null default 810,
  protein_g       int         not null default 30,
  carbs_g         int         not null default 65,
  fat_g           int         not null default 24,
  fiber_g         int         not null default 5,
  sodium_mg       int         not null default 900,
  sugar_g         int         not null default 10,
  -- optional measured outcomes { glucosePeak, satietyHours, energy, postMealWalk }
  signals         jsonb       not null default '{}',
  source          text        not null default 'manual',
  created_at      timestamptz not null default now()
);
create index if not exists meals_user_at_idx on public.meals (user_id, at desc);

-- ---------------------------------------------------------------------------
-- beverages — Beverage DNA (judged separately from meals)
-- ---------------------------------------------------------------------------
create table if not exists public.beverages (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users (id) on delete cascade,
  at                timestamptz not null default now(),
  type              text        not null default 'Water',
  serving_oz        numeric     not null default 12,
  calories          int         not null default 0,
  sugar_g           int         not null default 0,
  carbs_g           int         not null default 0,
  caffeine_mg       int         not null default 0,
  protein_g         int         not null default 0,
  alcohol_servings  numeric     not null default 0,
  notes             text        not null default '',
  tags              text[]      not null default '{}',
  source            text        not null default 'manual',
  created_at        timestamptz not null default now()
);
create index if not exists beverages_user_at_idx on public.beverages (user_id, at desc);

-- ---------------------------------------------------------------------------
-- activities — Workout DNA
-- ---------------------------------------------------------------------------
create table if not exists public.activities (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users (id) on delete cascade,
  at               timestamptz not null default now(),
  type             text        not null default 'walk',
  duration_min     int         not null default 0,
  calories_burned  int         not null default 0,
  distance_mi      numeric,
  source           text        not null default 'manual',
  created_at       timestamptz not null default now()
);
create index if not exists activities_user_at_idx on public.activities (user_id, at desc);

-- ---------------------------------------------------------------------------
-- body_entries — weight, composition, glucose, blood-work signals over time
-- ---------------------------------------------------------------------------
create table if not exists public.body_entries (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users (id) on delete cascade,
  at               timestamptz not null default now(),
  weight_lb        numeric,
  body_fat_pct     numeric,
  fasting_glucose  numeric,
  resting_hr       numeric,
  note             text        not null default '',
  created_at       timestamptz not null default now()
);
create index if not exists body_entries_user_at_idx on public.body_entries (user_id, at desc);

-- ---------------------------------------------------------------------------
-- weekly_reviews — cached generated reviews (Mon-anchored week_start)
-- ---------------------------------------------------------------------------
create table if not exists public.weekly_reviews (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  week_start    date        not null,
  payload       jsonb       not null,
  generated_at  timestamptz not null default now(),
  unique (user_id, week_start)
);

-- ---------------------------------------------------------------------------
-- updated_at trigger for profiles
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — every table is private to its owner.
-- The service-role key bypasses RLS for server-side endpoints; the anon key
-- (used from the browser with a logged-in session) is constrained by these
-- policies.
-- ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.meals         enable row level security;
alter table public.beverages     enable row level security;
alter table public.activities    enable row level security;
alter table public.body_entries  enable row level security;
alter table public.weekly_reviews enable row level security;

-- profiles: owner is the row id itself.
drop policy if exists "profiles_self" on public.profiles;
create policy "profiles_self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- owner-by-user_id policy applied to the remaining tables.
drop policy if exists "meals_owner" on public.meals;
create policy "meals_owner" on public.meals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "beverages_owner" on public.beverages;
create policy "beverages_owner" on public.beverages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "activities_owner" on public.activities;
create policy "activities_owner" on public.activities
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "body_entries_owner" on public.body_entries;
create policy "body_entries_owner" on public.body_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "weekly_reviews_owner" on public.weekly_reviews;
create policy "weekly_reviews_owner" on public.weekly_reviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Auto-create a profile row when a new auth user signs up, so the app always
-- has somewhere to read/write profile data.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', 'Friend'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

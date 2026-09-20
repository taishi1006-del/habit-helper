-- Supabase SQL Editorで一度だけ実行してください。
-- Supabase Authのauth.usersを認証の正本にし、public.usersはアプリ用プロフィールを保持します。

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  daily_goal integer not null default 3 check (daily_goal between 1 and 20),
  notifications_enabled boolean not null default false,
  ai_reflection_enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.users add column if not exists notifications_enabled boolean not null default false;

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  icon text not null default '💧',
  frequency_type text not null check (frequency_type in ('daily', 'weekly', 'monthly', 'selected_days')),
  target_per_week integer check (target_per_week between 1 and 7),
  target_per_month integer check (target_per_month between 1 and 31),
  target_value numeric check (target_value is null or target_value > 0),
  target_unit text check (target_unit is null or target_unit in ('回', '分', '杯', '個')),
  selected_days integer[],
  reminder_enabled boolean not null default true,
  reminder_time time not null default '20:00',
  smart_reminder boolean not null default false,
  start_date date not null default current_date,
  end_date date,
  tone text not null default 'mint',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (end_date is null or end_date >= start_date)
);

create table if not exists public.habit_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  date date not null,
  completed boolean not null default true,
  memo text,
  amount numeric check (amount is null or amount >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, habit_id, date)
);

create index if not exists habits_user_id_idx on public.habits(user_id);
create index if not exists habit_records_user_id_date_idx on public.habit_records(user_id, date desc);
create index if not exists habit_records_habit_id_date_idx on public.habit_records(habit_id, date desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.users enable row level security;
alter table public.habits enable row level security;
alter table public.habit_records enable row level security;

drop policy if exists "users_select_own" on public.users;
create policy "users_select_own" on public.users for select to authenticated using (id = auth.uid());
drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "habits_select_own" on public.habits;
create policy "habits_select_own" on public.habits for select to authenticated using (user_id = auth.uid());
drop policy if exists "habits_insert_own" on public.habits;
create policy "habits_insert_own" on public.habits for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "habits_update_own" on public.habits;
create policy "habits_update_own" on public.habits for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "habits_delete_own" on public.habits;
create policy "habits_delete_own" on public.habits for delete to authenticated using (user_id = auth.uid());

drop policy if exists "records_select_own" on public.habit_records;
create policy "records_select_own" on public.habit_records for select to authenticated using (user_id = auth.uid());
drop policy if exists "records_insert_own" on public.habit_records;
create policy "records_insert_own" on public.habit_records for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "records_update_own" on public.habit_records;
create policy "records_update_own" on public.habit_records for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "records_delete_own" on public.habit_records;
create policy "records_delete_own" on public.habit_records for delete to authenticated using (user_id = auth.uid());

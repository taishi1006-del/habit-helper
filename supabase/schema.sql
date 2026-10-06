-- Habit Helper DB setup
-- This script is intentionally non-destructive. It never drops tables, columns,
-- policies, triggers, or existing rows. It is safe to re-run after an interruption.
-- Run only after reviewing it in the Supabase SQL Editor.

begin;
set local search_path = pg_catalog, public;

-- Do not silently reuse an incompatible pre-existing table. Run the read-only
-- preflight query first; this guard stops before any write if required columns
-- are missing from an existing application table.
do $$
declare
  current_table_name text;
  required_columns text[];
  missing_columns text;
begin
  if current_user <> 'postgres' then
    raise exception 'Run this setup as the postgres role in the Supabase SQL Editor.';
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass and not tgisinternal
      and tgname <> 'on_auth_user_created'
  ) then
    raise exception 'Unexpected Auth trigger found. Review preflight.sql before continuing.';
  end if;

  for current_table_name, required_columns in
    select * from (values
      ('users', array['id', 'name', 'email', 'daily_goal',
        'notifications_enabled', 'ai_reflection_enabled', 'created_at']::text[]),
      ('habits', array[
        'id', 'user_id', 'name', 'icon', 'frequency_type',
        'target_per_week', 'target_per_month', 'target_value', 'target_unit',
        'selected_days', 'reminder_enabled', 'reminder_time', 'smart_reminder',
        'start_date', 'end_date', 'tone', 'created_at', 'updated_at'
      ]::text[]),
      ('habit_records', array[
        'id', 'user_id', 'habit_id', 'date', 'completed', 'memo', 'amount', 'created_at'
      ]::text[])
    ) as required(table_name, column_names)
  loop
    if to_regclass(format('public.%I', current_table_name)) is not null then
      if not exists (
        select 1 from pg_class
        where oid = to_regclass(format('public.%I', current_table_name))
          and relkind = 'r' and relowner = current_user::regrole
      ) or exists (
        select 1 from pg_trigger
        where tgrelid = to_regclass(format('public.%I', current_table_name))
          and not tgisinternal
      ) then
        raise exception 'Unexpected object, owner or trigger for public.%. Review it before continuing.', current_table_name;
      end if;
      select string_agg(required_column.column_name, ', ' order by required_column.column_name)
        into missing_columns
        from unnest(required_columns) as required_column(column_name)
       where not exists (
         select 1
           from information_schema.columns as columns
          where columns.table_schema = 'public'
            and columns.table_name = current_table_name
            and columns.column_name = required_column.column_name
       );

      if missing_columns is not null then
        raise exception 'Existing public.% table is missing required columns: %', current_table_name, missing_columns;
      end if;

      if exists (
        select 1 from pg_attribute as a
        where a.attrelid = to_regclass(format('public.%I', current_table_name))
          and a.attname = any(required_columns) and not a.attisdropped
          and (
            a.atttypid <> to_regtype(case
              when a.attname in ('id', 'user_id', 'habit_id') then 'uuid'
              when a.attname in ('daily_goal', 'target_per_week', 'target_per_month') then 'integer'
              when a.attname in ('target_value', 'amount') then 'numeric'
              when a.attname = 'selected_days' then 'integer[]'
              when a.attname in ('notifications_enabled', 'ai_reflection_enabled',
                'reminder_enabled', 'smart_reminder', 'completed') then 'boolean'
              when a.attname = 'reminder_time' then 'time without time zone'
              when a.attname in ('start_date', 'end_date', 'date') then 'date'
              when a.attname in ('created_at', 'updated_at') then 'timestamp with time zone'
              else 'text' end)
            or (a.attname not in ('target_per_week', 'target_per_month', 'target_value',
              'target_unit', 'selected_days', 'end_date', 'memo', 'amount') and not a.attnotnull)
          )
      ) then
        raise exception 'Existing public.% has incompatible column types or nullable required columns.', current_table_name;
      end if;

      if exists (
        select 1 from pg_attribute as a
        cross join lateral aclexplode(a.attacl) as permission
        where a.attrelid = to_regclass(format('public.%I', current_table_name))
          and not a.attisdropped and a.attnum > 0
          and permission.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
      ) then
        raise exception 'Unexpected client column grants on public.%. Review preflight.sql.', current_table_name;
      end if;
    end if;
  end loop;
end;
$$;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  daily_goal integer not null default 3 check (daily_goal between 1 and 20),
  notifications_enabled boolean not null default false,
  ai_reflection_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  icon text not null default '💧',
  frequency_type text not null default 'daily'
    check (frequency_type in ('daily', 'weekly', 'monthly', 'selected_days')),
  target_per_week integer check (target_per_week between 1 and 7),
  target_per_month integer check (target_per_month between 1 and 31),
  target_value numeric check (target_value is null or target_value > 0),
  target_unit text check (target_unit is null or target_unit in ('回', '分', '杯', '個')),
  selected_days integer[] check (
    selected_days is null
    or (array_ndims(selected_days) = 1
      and array_position(selected_days, null) is null
      and selected_days <@ array[1, 2, 3, 4, 5, 6, 7]::integer[])
  ),
  reminder_enabled boolean not null default true,
  reminder_time time not null default '20:00',
  smart_reminder boolean not null default false,
  start_date date not null default current_date,
  end_date date,
  tone text not null default 'mint',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (end_date is null or end_date >= start_date),
  constraint habits_selected_days_required check (
    frequency_type <> 'selected_days'
    or coalesce(array_length(selected_days, 1), 0) > 0
  ),
  constraint habits_weekly_target_required check (
    frequency_type <> 'weekly'
    or (target_per_week is not null and target_per_week between 1 and 7)
  ),
  constraint habits_monthly_target_required check (
    frequency_type <> 'monthly'
    or (target_per_month is not null and target_per_month between 1 and 31)
  )
);

create table if not exists public.habit_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  habit_id uuid not null,
  date date not null,
  completed boolean not null default true,
  memo text,
  amount numeric check (amount is null or amount >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, habit_id, date),
  constraint habit_records_habit_owner_fk
    foreign key (habit_id, user_id)
    references public.habits (id, user_id)
    on delete cascade
);

create index if not exists habits_user_id_idx
  on public.habits(user_id);

create index if not exists habit_records_user_id_date_idx
  on public.habit_records(user_id, date desc);

create index if not exists habit_records_habit_id_date_idx
  on public.habit_records(habit_id, date desc);

-- Validate key constraints by OID and ordered attribute numbers, never by
-- constraint names or pg_get_constraintdef() display strings.
do $$
declare
  expected record;
  source_oid oid;
  target_oid oid;
  source_keys smallint[];
  target_keys smallint[];
begin
  for expected in
    select * from (values
      ('public.users', 'p', array['id']::text[]),
      ('public.habits', 'p', array['id']::text[]),
      ('public.habit_records', 'p', array['id']::text[]),
      ('public.habits', 'u', array['id', 'user_id']::text[]),
      ('public.habit_records', 'u', array['user_id', 'habit_id', 'date']::text[])
    ) as keys(table_name, key_type, column_names)
  loop
    source_oid := to_regclass(expected.table_name);
    select array_agg(a.attnum order by names.position) into source_keys
    from unnest(expected.column_names) with ordinality as names(column_name, position)
    join pg_attribute as a on a.attrelid = source_oid
      and a.attname = names.column_name and not a.attisdropped;
    if cardinality(source_keys) is distinct from cardinality(expected.column_names)
      or not exists (
        select 1 from pg_constraint as c
        join pg_index as i on i.indexrelid = c.conindid
        where c.conrelid = source_oid and c.contype::text = expected.key_type
          and c.conkey = source_keys and not c.condeferrable
          and i.indisvalid and i.indisready
      ) then
      raise exception 'Missing or incompatible key on % (%).', expected.table_name, expected.column_names;
    end if;
  end loop;

  for expected in
    select * from (values
      ('public.users', array['id']::text[], 'auth.users', array['id']::text[]),
      ('public.habits', array['user_id']::text[], 'public.users', array['id']::text[]),
      ('public.habit_records', array['user_id']::text[], 'public.users', array['id']::text[]),
      ('public.habit_records', array['habit_id', 'user_id']::text[],
        'public.habits', array['id', 'user_id']::text[])
    ) as keys(source_table, source_columns, target_table, target_columns)
  loop
    source_oid := to_regclass(expected.source_table);
    target_oid := to_regclass(expected.target_table);
    select array_agg(a.attnum order by names.position) into source_keys
    from unnest(expected.source_columns) with ordinality as names(column_name, position)
    join pg_attribute as a on a.attrelid = source_oid
      and a.attname = names.column_name and not a.attisdropped;
    select array_agg(a.attnum order by names.position) into target_keys
    from unnest(expected.target_columns) with ordinality as names(column_name, position)
    join pg_attribute as a on a.attrelid = target_oid
      and a.attname = names.column_name and not a.attisdropped;
    if cardinality(source_keys) is distinct from cardinality(expected.source_columns)
      or cardinality(target_keys) is distinct from cardinality(expected.target_columns)
      or not exists (
        select 1 from pg_constraint as c
        where c.contype = 'f' and c.conrelid = source_oid and c.confrelid = target_oid
          and c.conkey = source_keys and c.confkey = target_keys
          and c.confdeltype = 'c' and c.confupdtype = 'a'
          and c.convalidated and not c.condeferrable
      ) then
      raise exception 'Missing or incompatible CASCADE foreign key from % (%) to % (%).',
        expected.source_table, expected.source_columns, expected.target_table, expected.target_columns;
    end if;
  end loop;

  -- Older or partially prepared definitions must be reviewed, not silently
  -- accepted by CREATE TABLE IF NOT EXISTS. This version names mandatory checks.
  for expected in
    select unnest(array['habits_selected_days_required', 'habits_weekly_target_required',
      'habits_monthly_target_required']) as constraint_name
  loop
    if not exists (
      select 1 from pg_constraint as c
      where c.conrelid = 'public.habits'::regclass and c.contype = 'c'
        and c.conname = expected.constraint_name and c.convalidated
    ) then
      raise exception 'Missing frequency check %. Review the existing table without overwriting it.', expected.constraint_name;
    end if;
  end loop;
end;
$$;

-- The API uses the authenticated user's JWT, so these grants are needed in
-- addition to RLS policies. Anonymous users receive no access to app tables.
-- Supabase default grants may include anon and privileges beyond CRUD.
-- Restrict only these three application tables, never auth.users or other tables.
revoke all on table public.users, public.habits, public.habit_records
  from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, update on public.users to authenticated;
grant select, insert, update, delete on public.habits to authenticated;
grant select, insert, update, delete on public.habit_records to authenticated;

-- New Auth users receive a profile automatically. If profile creation fails,
-- Auth signup still succeeds; the API backfills the profile on first login.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'private') then
    create schema private authorization postgres;
    revoke all on schema private from public, anon, authenticated;
  elsif has_schema_privilege('anon', 'private', 'USAGE')
    or has_schema_privilege('authenticated', 'private', 'USAGE')
    or has_schema_privilege('anon', 'private', 'CREATE')
    or has_schema_privilege('authenticated', 'private', 'CREATE') then
    raise exception 'Existing private schema is accessible to client roles. Review it without overwriting its permissions.';
  end if;
end;
$$;

do $$
declare
  function_oid oid;
  function_row record;
  function_body constant text := $body$
begin
  begin
    insert into public.users (id, name, email)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'name', ''),
      coalesce(new.email, '')
    )
    on conflict (id) do nothing;
  exception when others then
    raise warning 'Habit Helper profile creation failed for user %: %', new.id, sqlerrm;
  end;
  return new;
end;
$body$;
begin
  if exists (
    select 1 from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where p.proname = 'handle_new_user' and (
      n.nspname = 'public' or (n.nspname = 'private' and p.pronargs <> 0)
    )
  ) then
    raise exception 'Unexpected handle_new_user function or overload found. Review preflight.sql.';
  end if;

  function_oid := to_regprocedure('private.handle_new_user()');
  if function_oid is null then
    execute format($function$
      create function private.handle_new_user()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as %L;
    $function$, function_body);
  else
    select p.*, l.lanname into function_row
    from pg_proc as p join pg_language as l on l.oid = p.prolang
    where p.oid = function_oid;
    if not function_row.prosecdef or function_row.prokind <> 'f'
      or function_row.prorettype <> 'trigger'::regtype
      or function_row.proowner <> 'postgres'::regrole or function_row.lanname <> 'plpgsql'
      or not exists (
        select 1 from unnest(function_row.proconfig) as config(setting)
        where setting in ('search_path=', 'search_path=""')
      )
      or regexp_replace(function_row.prosrc, '\s+', '', 'g') <>
         regexp_replace(function_body, '\s+', '', 'g') then
      raise exception 'Existing private.handle_new_user() has an unexpected definition. Review it before continuing.';
    end if;
  end if;
end;
$$;

-- Trigger execution remains available to Auth; callers cannot invoke this
-- SECURITY DEFINER function through the public API.
revoke all on function private.handle_new_user() from public, anon, authenticated;

do $$
declare
  existing_trigger record;
begin
  select *
    into existing_trigger
    from pg_trigger
   where tgrelid = 'auth.users'::regclass
     and tgname = 'on_auth_user_created'
     and not tgisinternal;

  if not found then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function private.handle_new_user();
  elsif existing_trigger.tgfoid <> 'private.handle_new_user()'::regprocedure
    or existing_trigger.tgtype <> 5 or existing_trigger.tgenabled <> 'O'
    or existing_trigger.tgnargs <> 0 or existing_trigger.tgqual is not null
    or existing_trigger.tgconstraint <> 0 then
    raise exception 'Existing on_auth_user_created is not the expected enabled AFTER INSERT FOR EACH ROW trigger.';
  end if;
end;
$$;

-- Backfill profiles for Auth users that already exist. Existing profile rows
-- are preserved and are not overwritten.
insert into public.users (id, name, email)
select
  id,
  coalesce(raw_user_meta_data ->> 'name', ''),
  coalesce(email, '')
from auth.users
on conflict (id) do nothing;

alter table public.users enable row level security;
alter table public.habits enable row level security;
alter table public.habit_records enable row level security;

-- If a same-named policy already exists with a different owner condition,
-- stop instead of letting IF NOT EXISTS hide the unsafe definition.
do $$
declare
  expected_table text;
  expected_policy text;
  expected_command text;
  expected_expression text;
  policy_row record;
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename in ('users', 'habits', 'habit_records')
      and (tablename, policyname) not in (
        ('users', 'users_select_own'), ('users', 'users_insert_own'), ('users', 'users_update_own'),
        ('habits', 'habits_select_own'), ('habits', 'habits_insert_own'),
        ('habits', 'habits_update_own'), ('habits', 'habits_delete_own'),
        ('habit_records', 'records_select_own'), ('habit_records', 'records_insert_own'),
        ('habit_records', 'records_update_own'), ('habit_records', 'records_delete_own')
      )
  ) then
    raise exception 'Unexpected extra RLS policy found. Nothing will be replaced; review preflight.sql.';
  end if;

  for expected_table, expected_policy, expected_command, expected_expression in
    select * from (values
      ('users', 'users_select_own', 'SELECT', '(id=auth.uid())'),
      ('users', 'users_insert_own', 'INSERT', '(id=auth.uid())'),
      ('users', 'users_update_own', 'UPDATE', '(id=auth.uid())'),
      ('habits', 'habits_select_own', 'SELECT', '(user_id=auth.uid())'),
      ('habits', 'habits_insert_own', 'INSERT', '(user_id=auth.uid())'),
      ('habits', 'habits_update_own', 'UPDATE', '(user_id=auth.uid())'),
      ('habits', 'habits_delete_own', 'DELETE', '(user_id=auth.uid())'),
      ('habit_records', 'records_select_own', 'SELECT', '(user_id=auth.uid())'),
      ('habit_records', 'records_insert_own', 'INSERT', '(user_id=auth.uid())'),
      ('habit_records', 'records_update_own', 'UPDATE', '(user_id=auth.uid())'),
      ('habit_records', 'records_delete_own', 'DELETE', '(user_id=auth.uid())')
    ) as expected(table_name, policy_name, command_name, expression)
  loop
    select *
      into policy_row
      from pg_policies
     where schemaname = 'public'
       and tablename = expected_table
       and policyname = expected_policy;

    if found and (
      policy_row.permissive <> 'PERMISSIVE'
      or policy_row.roles <> array['authenticated']::name[]
      or policy_row.cmd <> expected_command
      or (
        expected_command in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        and regexp_replace(coalesce(policy_row.qual, ''), '\s+', '', 'g') <>
          case when expected_command in ('INSERT') then '' else expected_expression end
      )
      or (
        expected_command in ('INSERT', 'UPDATE')
        and regexp_replace(coalesce(policy_row.with_check, ''), '\s+', '', 'g') <> expected_expression
      )
      or (
        expected_command in ('SELECT', 'DELETE')
        and policy_row.with_check is not null
      )
    ) then
      raise exception 'Existing RLS policy %.% has an unexpected definition. Review it before continuing.', expected_table, expected_policy;
    end if;
  end loop;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'users_select_own') then
    create policy users_select_own on public.users for select to authenticated using (id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'users_insert_own') then
    create policy users_insert_own on public.users for insert to authenticated with check (id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'users_update_own') then
    create policy users_update_own on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'habits' and policyname = 'habits_select_own') then
    create policy habits_select_own on public.habits for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'habits' and policyname = 'habits_insert_own') then
    create policy habits_insert_own on public.habits for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'habits' and policyname = 'habits_update_own') then
    create policy habits_update_own on public.habits for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'habits' and policyname = 'habits_delete_own') then
    create policy habits_delete_own on public.habits for delete to authenticated using (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'habit_records' and policyname = 'records_select_own') then
    create policy records_select_own on public.habit_records for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'habit_records' and policyname = 'records_insert_own') then
    create policy records_insert_own on public.habit_records for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'habit_records' and policyname = 'records_update_own') then
    create policy records_update_own on public.habit_records for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'habit_records' and policyname = 'records_delete_own') then
    create policy records_delete_own on public.habit_records for delete to authenticated using (user_id = auth.uid());
  end if;
end;
$$;

commit;

select 'SCHEMA_SETUP_COMPLETE' as status;

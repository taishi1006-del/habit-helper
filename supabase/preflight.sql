-- Habit Helper: BEFORE setup. SELECT only; no objects or data are changed.
-- Run as postgres in project ntmswfrxqkztztlqzilk.
-- Review the detailed queries as needed; the final result is the summary.
-- Database name is not proof of the project: check the Dashboard project URL.

select current_database() as database_name, current_user as executing_role,
  current_setting('search_path') as search_path, version() as postgres_version;

select expected.table_name, c.oid is not null as table_exists, c.relkind,
  pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as rls_enabled
from (values ('users'), ('habits'), ('habit_records')) as expected(table_name)
left join pg_namespace as n on n.nspname = 'public'
left join pg_class as c on c.relnamespace = n.oid and c.relname = expected.table_name
order by expected.table_name;

select count(*) as auth_user_count,
  count(*) filter (where email_confirmed_at is not null) as email_confirmed_user_count
from auth.users;

select table_name, ordinal_position, column_name, data_type, udt_name,
  is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('users', 'habits', 'habit_records')
order by table_name, ordinal_position;

-- pg_get_constraintdef is for human-readable display only.
-- The ordered arrays and relation OIDs are used for structural inspection.
select n.nspname as schema_name, c.relname as table_name, con.conname,
  con.contype, con.convalidated,
  array(
    select a.attname::text from unnest(con.conkey) with ordinality as k(attnum, position)
    join pg_attribute as a on a.attrelid = con.conrelid and a.attnum = k.attnum
    order by k.position
  ) as source_columns,
  target_namespace.nspname as referenced_schema, target.relname as referenced_table,
  array(
    select a.attname::text from unnest(con.confkey) with ordinality as k(attnum, position)
    join pg_attribute as a on a.attrelid = con.confrelid and a.attnum = k.attnum
    order by k.position
  ) as referenced_columns,
  con.confdeltype = 'c' as on_delete_cascade,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint as con
join pg_class as c on c.oid = con.conrelid
join pg_namespace as n on n.oid = c.relnamespace
left join pg_class as target on target.oid = con.confrelid
left join pg_namespace as target_namespace on target_namespace.oid = target.relnamespace
where n.nspname = 'public' and c.relname in ('users', 'habits', 'habit_records')
order by c.relname, con.conname;

-- Show ALL policies, including unexpected additional policies.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('users', 'habits', 'habit_records')
order by tablename, policyname;

select n.nspname as schema_name, c.relname as table_name,
  case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  acl.privilege_type, acl.is_grantable
from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as acl
where n.nspname = 'public' and c.relname in ('users', 'habits', 'habit_records')
order by c.relname, grantee, acl.privilege_type;

select c.relname as table_name, a.attname as column_name,
  case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  acl.privilege_type
from pg_attribute as a join pg_class as c on c.oid = a.attrelid
join pg_namespace as n on n.oid = c.relnamespace
cross join lateral aclexplode(a.attacl) as acl
where n.nspname = 'public' and c.relname in ('users', 'habits', 'habit_records')
  and a.attnum > 0 and not a.attisdropped
order by c.relname, a.attname, grantee;

select n.nspname as schema_name, p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments, p.prokind,
  pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer,
  p.proconfig as configuration,
  case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end as definition
from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
where p.proname = 'handle_new_user' and n.nspname in ('public', 'private');

select n.nspname as table_schema, c.relname as table_name,
  t.tgname as trigger_name, t.tgenabled as enabled,
  fn.nspname as function_schema, p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as function_arguments,
  pg_get_triggerdef(t.oid) as definition
from pg_trigger as t join pg_class as c on c.oid = t.tgrelid
join pg_namespace as n on n.oid = c.relnamespace
join pg_proc as p on p.oid = t.tgfoid
join pg_namespace as fn on fn.oid = p.pronamespace
where not t.tgisinternal and (
  t.tgrelid = 'auth.users'::regclass or
  (n.nspname = 'public' and c.relname in ('users', 'habits', 'habit_records'))
)
order by n.nspname, c.relname, t.tgname;

-- For the current empty project, expect READY_FOR_INITIAL_SETUP, false/false/false,
-- Auth users=1, confirmed=1, routines=0, Auth triggers=0 and app policies=0.
-- If existing objects appear, review the detailed queries BEFORE running schema.sql.
with state as (
  select current_user as executing_role,
    to_regclass('public.users') is not null as users_exists,
    to_regclass('public.habits') is not null as habits_exists,
    to_regclass('public.habit_records') is not null as habit_records_exists,
    (select count(*) from auth.users) as auth_user_count,
    (select count(*) from auth.users where email_confirmed_at is not null) as email_confirmed_user_count,
    (select count(*) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
      where p.proname = 'handle_new_user' and n.nspname in ('public', 'private')) as profile_routine_count,
    (select count(*) from pg_trigger where tgrelid = 'auth.users'::regclass
      and not tgisinternal) as auth_trigger_count,
    (select count(*) from pg_policies where schemaname = 'public'
      and tablename in ('users', 'habits', 'habit_records')) as app_policy_count,
    coalesce((select
      has_schema_privilege('anon', oid, 'USAGE') or
      has_schema_privilege('anon', oid, 'CREATE') or
      has_schema_privilege('authenticated', oid, 'USAGE') or
      has_schema_privilege('authenticated', oid, 'CREATE')
      from pg_namespace where nspname = 'private'), false) as private_schema_client_access
)
select case when executing_role = 'postgres'
  and not users_exists and not habits_exists and not habit_records_exists
  and profile_routine_count = 0 and auth_trigger_count = 0 and app_policy_count = 0
  and not private_schema_client_access
  then 'READY_FOR_INITIAL_SETUP' else 'REVIEW_EXISTING_OBJECTS' end as preflight_status,
  state.*
from state;

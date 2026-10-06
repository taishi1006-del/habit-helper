-- Habit Helper: AFTER setup. SELECT only; no objects or data are changed.
-- Run after schema.sql succeeds. The last result is a consolidated checklist.
-- These catalog checks do not replace real JWT tests with users A and B.

select c.relname as table_name, c.relkind, pg_get_userbyid(c.relowner) as owner,
  c.relrowsecurity as rls_enabled
from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('users', 'habits', 'habit_records')
order by c.relname;

select count(*) as auth_user_count,
  count(*) filter (where email_confirmed_at is not null) as email_confirmed_user_count,
  (select count(*) from public.users) as profile_count,
  count(*) filter (where profiles.id is null) as auth_users_without_profile
from auth.users as auth_users left join public.users as profiles on profiles.id = auth_users.id;

select c.relname as table_name, con.conname, con.contype, con.convalidated,
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
from pg_constraint as con join pg_class as c on c.oid = con.conrelid
join pg_namespace as n on n.oid = c.relnamespace
left join pg_class as target on target.oid = con.confrelid
left join pg_namespace as target_namespace on target_namespace.oid = target.relnamespace
where n.nspname = 'public' and c.relname in ('users', 'habits', 'habit_records')
order by c.relname, con.conname;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('users', 'habits', 'habit_records')
order by tablename, policyname;

select n.nspname as schema_name, p.proname as function_name,
  pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer,
  p.proconfig as configuration, pg_get_functiondef(p.oid) as definition
from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
where p.oid = to_regprocedure('private.handle_new_user()');

select t.tgname as trigger_name, t.tgenabled as enabled,
  n.nspname as function_schema, p.proname as function_name,
  pg_get_triggerdef(t.oid) as definition
from pg_trigger as t join pg_proc as p on p.oid = t.tgfoid
join pg_namespace as n on n.oid = p.pronamespace
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;

-- Verify effective role privileges, including grants inherited through PUBLIC.
select c.relname as table_name, role.role_name,
  has_table_privilege(role.role_name, c.oid, 'SELECT') as can_select,
  has_table_privilege(role.role_name, c.oid, 'INSERT') as can_insert,
  has_table_privilege(role.role_name, c.oid, 'UPDATE') as can_update,
  has_table_privilege(role.role_name, c.oid, 'DELETE') as can_delete,
  has_table_privilege(role.role_name, c.oid, 'TRUNCATE') as can_truncate,
  has_table_privilege(role.role_name, c.oid, 'REFERENCES') as can_reference,
  has_table_privilege(role.role_name, c.oid, 'TRIGGER') as can_create_trigger
from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
cross join (values ('anon'::text), ('authenticated'::text)) as role(role_name)
where n.nspname = 'public' and c.relname in ('users', 'habits', 'habit_records')
order by c.relname, role.role_name;

with expected_policies(table_name, policy_name, command_name, owner_expression) as (
  values
    ('users', 'users_select_own', 'SELECT', 'id=auth.uid'),
    ('users', 'users_insert_own', 'INSERT', 'id=auth.uid'),
    ('users', 'users_update_own', 'UPDATE', 'id=auth.uid'),
    ('habits', 'habits_select_own', 'SELECT', 'user_id=auth.uid'),
    ('habits', 'habits_insert_own', 'INSERT', 'user_id=auth.uid'),
    ('habits', 'habits_update_own', 'UPDATE', 'user_id=auth.uid'),
    ('habits', 'habits_delete_own', 'DELETE', 'user_id=auth.uid'),
    ('habit_records', 'records_select_own', 'SELECT', 'user_id=auth.uid'),
    ('habit_records', 'records_insert_own', 'INSERT', 'user_id=auth.uid'),
    ('habit_records', 'records_update_own', 'UPDATE', 'user_id=auth.uid'),
    ('habit_records', 'records_delete_own', 'DELETE', 'user_id=auth.uid')
),
policy_checks as (
  select e.*, coalesce(
    p.cmd = e.command_name and p.permissive = 'PERMISSIVE'
    and p.roles = array['authenticated']::name[]
    and regexp_replace(coalesce(p.qual, ''), '[[:space:]()]', '', 'g') =
      case when e.command_name = 'INSERT' then '' else e.owner_expression end
    and regexp_replace(coalesce(p.with_check, ''), '[[:space:]()]', '', 'g') =
      case when e.command_name in ('INSERT', 'UPDATE') then e.owner_expression else '' end,
    false) as valid
  from expected_policies as e left join pg_policies as p
    on p.schemaname = 'public' and p.tablename = e.table_name and p.policyname = e.policy_name
),
app_tables as (
  select c.* from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('users', 'habits', 'habit_records')
),
checks as (
  select
    (select count(*) = 3 and bool_and(relkind = 'r') from app_tables) as tables_ok,
    (select count(*) = 3 and bool_and(relrowsecurity) from app_tables) as rls_enabled,
    (select bool_and(valid) from policy_checks) as required_policies_ok,
    (select count(*) from pg_policies as p
      where p.schemaname = 'public' and p.tablename in ('users', 'habits', 'habit_records')
      and not exists (select 1 from expected_policies as e
        where e.table_name = p.tablename and e.policy_name = p.policyname)) as unexpected_policy_count,
    exists (
      select 1 from pg_constraint as c
      where c.conrelid = to_regclass('public.habit_records')
        and c.confrelid = to_regclass('public.habits') and c.contype = 'f'
        and c.confdeltype = 'c' and c.confupdtype = 'a'
        and c.convalidated and not c.condeferrable
        and array(select a.attname::text
          from unnest(c.conkey) with ordinality as k(attnum, position)
          join pg_attribute as a on a.attrelid = c.conrelid and a.attnum = k.attnum
          where not a.attisdropped order by k.position) = array['habit_id', 'user_id']::text[]
        and array(select a.attname::text
          from unnest(c.confkey) with ordinality as k(attnum, position)
          join pg_attribute as a on a.attrelid = c.confrelid and a.attnum = k.attnum
          where not a.attisdropped order by k.position) = array['id', 'user_id']::text[]
    ) as composite_owner_fk_ok,
    exists (
      select 1 from pg_proc as p join pg_language as l on l.oid = p.prolang
      where p.oid = to_regprocedure('private.handle_new_user()')
        and p.prosecdef and p.prokind = 'f' and p.prorettype = 'trigger'::regtype
        and p.proowner = 'postgres'::regrole and l.lanname = 'plpgsql'
        and exists (select 1 from unnest(p.proconfig) as config(setting)
          where setting in ('search_path=', 'search_path=""'))
        and not has_function_privilege('anon', p.oid, 'EXECUTE')
        and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) as profile_function_ok,
    (select count(*) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
      where p.proname = 'handle_new_user' and (
        n.nspname = 'public' or (n.nspname = 'private' and p.pronargs <> 0)
      )) as unexpected_profile_routine_count,
    exists (
      select 1 from pg_trigger as t
      where t.tgrelid = 'auth.users'::regclass and t.tgname = 'on_auth_user_created'
        and t.tgfoid = to_regprocedure('private.handle_new_user()')
        and not t.tgisinternal and t.tgtype = 5 and t.tgenabled = 'O'
        and t.tgnargs = 0 and t.tgqual is null and t.tgconstraint = 0
    ) as auth_trigger_ok,
    (select count(*) from pg_trigger where tgrelid = 'auth.users'::regclass
      and not tgisinternal and tgname <> 'on_auth_user_created') as unexpected_auth_trigger_count,
    (select bool_and(not has_schema_privilege(role_name, n.oid, 'USAGE')
      and not has_schema_privilege(role_name, n.oid, 'CREATE'))
      from pg_namespace as n cross join (values ('anon'::text), ('authenticated'::text)) as roles(role_name)
      where n.nspname = 'private') as private_schema_ok,
    (select count(*) from auth.users) as auth_user_count,
    (select count(*) from auth.users where email_confirmed_at is not null) as email_confirmed_user_count,
    (select count(*) from public.users) as profile_count,
    (select count(*) from auth.users as a left join public.users as p on p.id = a.id
      where p.id is null) as auth_users_without_profile,
    (select bool_and(not has_table_privilege('anon', oid,
      'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')) from app_tables) as anonymous_privileges_ok,
    (select bool_and(
      has_table_privilege('authenticated', oid, 'SELECT')
      and has_table_privilege('authenticated', oid, 'INSERT')
      and has_table_privilege('authenticated', oid, 'UPDATE')
      and has_table_privilege('authenticated', oid, 'DELETE') = (relname <> 'users')
      and not has_table_privilege('authenticated', oid, 'TRUNCATE, REFERENCES, TRIGGER')
    ) from app_tables) as authenticated_privileges_ok
)
select case when tables_ok and rls_enabled and required_policies_ok
  and unexpected_policy_count = 0 and composite_owner_fk_ok and profile_function_ok
  and unexpected_profile_routine_count = 0
  and auth_trigger_ok and unexpected_auth_trigger_count = 0 and private_schema_ok
  and auth_users_without_profile = 0 and anonymous_privileges_ok and authenticated_privileges_ok
  then 'VERIFY_OK' else 'REVIEW_REQUIRED' end as verification_status,
  checks.*
from checks;

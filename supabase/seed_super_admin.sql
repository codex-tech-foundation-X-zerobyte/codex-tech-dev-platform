-- Create the first super admin. Run in the Supabase SQL Editor, once.
-- 1. Dashboard > Authentication > Users > Add user (email + password). Tick "Auto confirm user".
-- 2. Replace the email below with that user's email, then run this script.
insert into admin.admins (user_id, role)
select id, 'super_admin' from auth.users where lower(email) = lower('YOU@YOUR-DOMAIN.COM')
on conflict (user_id) do update set role = 'super_admin';

-- Check: should return one row with role super_admin.
select u.email, a.role from admin.admins a join auth.users u on u.id = a.user_id;

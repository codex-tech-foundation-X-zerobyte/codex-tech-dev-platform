-- Local test. Run after stub_supabase.sql, 20261020000001_waitlist.sql, 20261020000002_admin.sql.
\set ON_ERROR_STOP off
insert into auth.users (id,email) values
 ('00000000-0000-0000-0000-0000000000a1','super@x.com'),
 ('00000000-0000-0000-0000-0000000000a2','admin@x.com'),
 ('00000000-0000-0000-0000-0000000000a3','viewer@x.com'),
 ('00000000-0000-0000-0000-0000000000a4','nobody@x.com');
insert into admin.admins (user_id, role) values
 ('00000000-0000-0000-0000-0000000000a1','super_admin'),
 ('00000000-0000-0000-0000-0000000000a2','admin'),
 ('00000000-0000-0000-0000-0000000000a3','viewer');

\echo '--- anon can join waitlist, cannot touch tables or admin RPCs'
set role anon;
select public.join_waitlist('Ada@Example.com','typescript','paystack','hello',true,null);
select public.join_waitlist('ada@example.com','go','stripe',null,true,null);   -- duplicate hidden
select public.join_waitlist('bot@example.com','go','stripe',null,true,'spam'); -- honeypot, not stored
select public.join_waitlist('bad','go','stripe',null,true,null);               -- invalid email
select public.join_waitlist('x@example.com','go','stripe',null,false,null);    -- no consent
select * from waitlist.signups;                                                 -- must be permission denied
select public.admin_waitlist_stats();                                           -- must be permission denied
reset role;
select count(*) as stored_rows_expect_1 from waitlist.signups;

select id as sid from waitlist.signups limit 1 \gset
\echo '--- nobody (authenticated, no admin role) is forbidden'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
select public.admin_me() as role_expect_null;
select public.admin_waitlist_stats();                                           -- forbidden

\echo '--- viewer: can read, cannot edit or see team'
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
select public.admin_me() as role_expect_viewer;
select (public.admin_waitlist_list(null,null,null,null,25,0)->>'total') as total_expect_1;
select public.admin_waitlist_set_status(:'sid','invited'); -- permission denied on table? must be forbidden
select public.admin_team_list();                                                -- forbidden
select public.admin_audit_list(25,0);                                           -- forbidden

\echo '--- admin: can edit, cannot manage team'
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select public.admin_waitlist_stats()->>'total' as total_expect_1;
select public.admin_waitlist_set_status(:'sid','invited');
select public.admin_waitlist_set_status(:'sid','bogus'); -- invalid_status
select public.admin_team_add('viewer@x.com','admin');                           -- forbidden
select jsonb_array_length(public.admin_audit_list(25,0)->'rows') as audit_rows_expect_1;

\echo '--- super admin: team management and safety rules'
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select jsonb_array_length(public.admin_team_list()) as team_expect_3;
select public.admin_team_add('nobody@x.com','viewer');
select public.admin_team_add('ghost@x.com','viewer');                           -- user_not_found
select public.admin_team_set_role('00000000-0000-0000-0000-0000000000a1','viewer'); -- cannot_change_self
select public.admin_team_remove('00000000-0000-0000-0000-0000000000a1');        -- cannot_remove_self
select public.admin_team_set_role('00000000-0000-0000-0000-0000000000a4','admin');
select public.admin_team_remove('00000000-0000-0000-0000-0000000000a4');
select public.admin_waitlist_list('ADA%',null,null,null,25,0)->>'total' as search_with_wildcard_expect_0;
select public.admin_waitlist_list('ada',null,null,'invited',25,0)->>'total' as search_expect_1;
select public.admin_waitlist_delete(:'sid');
select (public.admin_waitlist_stats()->>'total') as total_expect_0;
select action, target from admin.audit_log order by id; -- permission denied (not exposed)
reset role;
select action, target from admin.audit_log order by id;

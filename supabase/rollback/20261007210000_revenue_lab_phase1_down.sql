begin;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'revenue-lab-daily-youtube';
  end if;
end $$;
revoke all privileges on all tables in schema revenue_lab from service_role;
revoke all privileges on all functions in schema revenue_lab from service_role;
drop schema if exists revenue_lab cascade;
commit;

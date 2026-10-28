begin;

drop function if exists revenue_lab.fail_youtube_analytics_run(uuid, text, boolean);
drop function if exists revenue_lab.finish_youtube_analytics_run(uuid, jsonb, boolean);
drop function if exists revenue_lab.start_youtube_analytics_run(uuid, uuid, date, date, text, text[]);
drop function if exists revenue_lab.upsert_youtube_analytics_connection(uuid, text, text, text[], text);
drop table if exists revenue_lab.youtube_performance_snapshots;
drop table if exists revenue_lab.youtube_analytics_runs;
drop table if exists revenue_lab.youtube_analytics_connections;

commit;

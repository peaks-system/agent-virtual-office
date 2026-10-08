begin;

insert into revenue_lab.projects (id, slug, name)
values ('10000000-0000-4000-8000-000000000001', 'youtube-commerce', 'YouTube Commerce')
on conflict (id) do update set name = excluded.name, updated_at = now();

insert into revenue_lab.sources (id, project_id, provider, name)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'youtube', 'YouTube Data API')
on conflict (id) do update set name = excluded.name, updated_at = now();

insert into revenue_lab.source_queries
  (id, source_id, label, query_text, buyer_intent, commerce_fit, enabled)
values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'テーマ1', 'デスク ガジェット', null, null, false),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'テーマ2', '生活家電', null, null, false),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'テーマ3', '便利グッズ', null, null, false)
on conflict (id) do update set
  label = excluded.label,
  query_text = excluded.query_text,
  updated_at = now();

commit;

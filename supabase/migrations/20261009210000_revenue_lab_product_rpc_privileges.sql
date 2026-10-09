begin;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Remove that
-- inherited path before granting the server-only role explicitly.
revoke execute on function revenue_lab.enqueue_product_search(uuid, text, jsonb, text, text, text, date)
  from public, anon, authenticated;
revoke execute on function revenue_lab.record_product_candidate_decision(uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function revenue_lab.enqueue_product_search(uuid, text, jsonb, text, text, text, date)
  to service_role;
grant execute on function revenue_lab.record_product_candidate_decision(uuid, uuid, text, text)
  to service_role;

commit;

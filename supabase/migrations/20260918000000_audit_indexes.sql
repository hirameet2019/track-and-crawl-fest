-- Audit log browsing: newest-first paging, filter by action / entity / actor.
create index if not exists audit_log_created_idx on audit_log (created_at desc);
create index if not exists audit_log_action_idx  on audit_log (action, created_at desc);
create index if not exists audit_log_entity_idx  on audit_log (entity, entity_id);
create index if not exists audit_log_actor_idx   on audit_log (actor, created_at desc);

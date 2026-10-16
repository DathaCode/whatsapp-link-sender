-- The audit log is append-only. Rows can never be changed, and only rows older than
-- 30 days can be deleted (the retention job). AUDIT_RETENTION_DAYS has a minimum of 30 to match.
CREATE TRIGGER `audit_log_no_update`
BEFORE UPDATE ON `audit_log`
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_recent_delete`
BEFORE DELETE ON `audit_log`
WHEN OLD.`ts` > (CAST(strftime('%s', 'now') AS INTEGER) - 30 * 86400) * 1000
BEGIN
  SELECT RAISE(ABORT, 'audit_log rows younger than 30 days cannot be deleted');
END;

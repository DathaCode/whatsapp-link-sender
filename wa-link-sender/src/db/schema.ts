import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/*
 * Portable schema: plain integer/text columns, epoch-millisecond timestamps (UTC),
 * JSON stored as text. Moving to Postgres later means swapping sqlite-core for pg-core
 * and regenerating migrations, without rewriting queries.
 */

export const ROLES = ['ADMIN', 'USER'] as const;
export type Role = (typeof ROLES)[number];

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: ROLES }).notNull(),
    passwordHash: text('password_hash').notNull(),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    lastLoginAt: integer('last_login_at'),
    passwordChangedAt: integer('password_changed_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('users_username_uq').on(sql`lower(${t.username})`)],
);

/** Server-side sessions. The cookie holds a random token; only its SHA-256 is stored. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // public session id (used in audit rows and for CSRF)
    tokenHash: text('token_hash').notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    expiresAt: integer('expires_at').notNull(), // absolute timeout
    ip: text('ip'),
    userAgent: text('user_agent'),
    revokedAt: integer('revoked_at'),
    revokeReason: text('revoke_reason'),
  },
  (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

/** Failed-login throttle keyed by lower-cased username (also for names that don't exist). */
export const loginThrottle = sqliteTable('login_throttle', {
  username: text('username').primaryKey(),
  failures: integer('failures').notNull().default(0),
  lockedUntil: integer('locked_until'),
  updatedAt: integer('updated_at').notNull(),
});

export const CONNECTION_STATUSES = [
  'linking', // QR shown, waiting for the phone
  'link_expired', // QR not scanned in time
  'standby', // linked, session saved, not running
  'connecting',
  'connected',
  'disconnected', // temporarily; reconnecting
  'logged_out',
  'possibly_banned',
  'retired',
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const connections = sqliteTable(
  'connections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    label: text('label').notNull(),
    clientId: text('client_id').notNull(),
    status: text('status', { enum: CONNECTION_STATUSES }).notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    phone: text('phone'),
    pushName: text('push_name'),
    addedAt: integer('added_at').notNull(),
    addedBy: integer('added_by').references(() => users.id),
    linkedAt: integer('linked_at'),
    lastError: text('last_error'),
    lastErrorAt: integer('last_error_at'),
    retiredAt: integer('retired_at'),
    retiredBy: integer('retired_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('connections_client_uq').on(t.clientId),
    // Exactly one active connection (at most one row may have is_active = 1).
    uniqueIndex('connections_one_active_uq').on(t.isActive).where(sql`${t.isActive} = 1`),
  ],
);

/** Groups as seen by a particular connection (group ids are global WhatsApp ids). */
export const groups = sqliteTable(
  'groups',
  {
    connectionId: integer('connection_id')
      .notNull()
      .references(() => connections.id),
    groupId: text('group_id').notNull(),
    name: text('name').notNull(),
    readOnly: integer('read_only', { mode: 'boolean' }).notNull().default(false),
    /** Why this number can't post here (null = it can). */
    reason: text('reason'),
    kind: text('kind', { enum: ['group', 'announcement', 'community'] }).notNull().default('group'),
    communityId: text('community_id'),
    communityName: text('community_name'),
    participants: integer('participants'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.groupId] })],
);

export const presets = sqliteTable(
  'presets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('presets_name_uq').on(sql`lower(${t.name})`)],
);

export const presetGroups = sqliteTable(
  'preset_groups',
  {
    presetId: integer('preset_id')
      .notNull()
      .references(() => presets.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    groupName: text('group_name').notNull(), // snapshot so the list reads well even if the group is gone
  },
  (t) => [primaryKey({ columns: [t.presetId, t.groupId] })],
);

export const presetAccess = sqliteTable(
  'preset_access',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    presetId: integer('preset_id')
      .notNull()
      .references(() => presets.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.presetId] })],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON
});

export const JOB_STATUSES = ['queued', 'running', 'waiting', 'done', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const WAIT_REASONS = ['connection_down', 'outside_hours', 'daily_cap'] as const;
export type WaitReason = (typeof WAIT_REASONS)[number] | null;

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    /** v2 jobs: the single post URL. v3+: the first main link (or '') — kept so old history stays readable. */
    url: text('url').notNull(),
    /** v2 jobs: facebook | tiktok | youtube. v3+: 'message'. */
    platform: text('platform').notNull(),
    /** v2 jobs only (templates were removed). */
    templateId: integer('template_id'),
    /** Exact text that is sent (after tracking-parameter cleanup). Null for v2 jobs. */
    messageText: text('message_text'),
    messageSha256: text('message_sha256'),
    /** Whitespace-collapsed hash, for duplicate detection only. */
    textKey: text('text_key'),
    imageId: text('image_id'),
    imageSha256: text('image_sha256'),
    /** text | single (image + caption) | two (image, then text) */
    sendMode: text('send_mode', { enum: ['text', 'single', 'two'] }),
    /** JSON [{original, cleaned, host}] */
    links: text('links'),
    /** JSON: warnings shown at request time and how they were resolved. */
    warnings: text('warnings'),
    presetIds: text('preset_ids').notNull().default('[]'), // JSON number[]
    status: text('status', { enum: JOB_STATUSES }).notNull(),
    waitReason: text('wait_reason', { enum: WAIT_REASONS }),
    parentJobId: integer('parent_job_id'),
    requestedConnectionId: integer('requested_connection_id').references(() => connections.id),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    cancelledBy: integer('cancelled_by').references(() => users.id),
  },
  (t) => [
    index('jobs_status_idx').on(t.status),
    index('jobs_url_idx').on(t.url),
    index('jobs_user_idx').on(t.userId),
    index('jobs_text_key_idx').on(t.textKey),
    index('jobs_image_sha_idx').on(t.imageSha256),
  ],
);

/** Canonical "main" links of each send (footer/repeating links excluded), for duplicate detection. */
export const jobMainLinks = sqliteTable(
  'job_main_links',
  {
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id),
    link: text('link').notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.link] }), index('job_main_links_link_idx').on(t.link)],
);

export const RESULT_STATUSES = ['pending', 'sending', 'sent', 'failed', 'cancelled'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

/** One row per (job, group): the per-group outcome, linked to the audit entry that recorded it. */
export const sendResults = sqliteTable(
  'send_results',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id),
    groupId: text('group_id').notNull(),
    groupName: text('group_name').notNull(),
    status: text('status', { enum: RESULT_STATUSES }).notNull(),
    message: text('message'),
    error: text('error'),
    connectionId: integer('connection_id').references(() => connections.id),
    attemptedAt: integer('attempted_at'),
    day: text('day'), // YYYY-MM-DD in TZ, for the per-connection daily cap
    /** WhatsApp messages this result costs against the daily cap (2 in two-message image mode). */
    messagesCount: integer('messages_count').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    auditId: integer('audit_id').references(() => auditLog.id),
  },
  (t) => [
    index('send_results_job_idx').on(t.jobId),
    index('send_results_day_idx').on(t.connectionId, t.day),
  ],
);

export const OUTCOMES = ['success', 'failure', 'denied'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * Append-only. The app has no UPDATE path; database triggers (see migrations) reject
 * UPDATE outright and reject DELETE of rows younger than 30 days (retention pruning only).
 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts').notNull(), // epoch ms, UTC
    actorUserId: integer('actor_user_id'),
    actorUsername: text('actor_username').notNull(), // username | 'anonymous' | 'system'
    actorRole: text('actor_role'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    sessionId: text('session_id'),
    action: text('action').notNull(), // e.g. auth.login
    category: text('category').notNull(), // prefix of action
    targetType: text('target_type'),
    targetId: text('target_id'),
    outcome: text('outcome', { enum: OUTCOMES }).notNull(),
    reason: text('reason'),
    details: text('details'), // JSON, secrets redacted
    connectionId: integer('connection_id'),
  },
  (t) => [
    index('audit_ts_idx').on(t.ts),
    index('audit_actor_idx').on(t.actorUserId, t.ts),
    index('audit_category_idx').on(t.category, t.ts),
    index('audit_outcome_idx').on(t.outcome, t.ts),
  ],
);

/** Images attached to messages. Files live in DATA_DIR/uploads/<id>.jpg (re-encoded, metadata stripped). */
export const uploads = sqliteTable(
  'uploads',
  {
    id: text('id').primaryKey(), // random hex, also the file name
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    originalName: text('original_name').notNull(),
    originalSize: integer('original_size').notNull(),
    originalType: text('original_type').notNull(), // detected from content: jpeg | png | webp
    originalSha256: text('original_sha256').notNull(),
    size: integer('size').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sha256: text('sha256').notNull(), // of the processed JPEG
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('uploads_created_idx').on(t.createdAt), index('uploads_orig_sha_idx').on(t.originalSha256)],
);

/** Autosaved message draft, one per user. */
export const drafts = sqliteTable('drafts', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id),
  text: text('text').notNull().default(''),
  uploadId: text('upload_id'),
  updatedAt: integer('updated_at').notNull(),
});

/** Reusable text blocks (e.g. the FOLLOW US footer), managed by admins. */
export const snippets = sqliteTable('snippets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  body: text('body').notNull(),
  sort: integer('sort').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export type Platform = 'facebook' | 'tiktok' | 'youtube';
export type Role = 'ADMIN' | 'USER';
export type JobStatus = 'queued' | 'running' | 'waiting' | 'done' | 'cancelled';
export type WaitReason = 'connection_down' | 'outside_hours' | 'daily_cap' | null;
export type ItemStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';
export type Outcome = 'success' | 'failure' | 'denied';
export type ConnectionStatus =
  | 'linking'
  | 'link_expired'
  | 'standby'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'logged_out'
  | 'possibly_banned'
  | 'retired';
export type PauseReason = 'no_active' | 'connecting' | 'disconnected' | 'logged_out' | 'possibly_banned' | 'linking' | null;

export interface Me {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
}

export interface SendingStatus {
  available: boolean;
  accepting: boolean;
  reason: PauseReason;
  connection: { id: number; label: string; phone: string | null; status: ConnectionStatus } | null;
}
export interface QueueStatus {
  activeJobId: number | null;
  waitReason: WaitReason;
  nextSendAt: number | null;
  queued: number;
}
export interface Usage {
  day: string;
  used: number;
  cap: number;
  connectionId: number | null;
}
export interface SafetySettings {
  minDelaySeconds: number;
  maxDelaySeconds: number;
  imageMinDelaySeconds: number;
  imageMaxDelaySeconds: number;
  imageSendMode: 'single' | 'two';
  dailyCap: number;
  windowStart: string;
  windowEnd: string;
}
export type GroupKind = 'group' | 'announcement' | 'community';
export interface Group {
  id: string;
  name: string;
  readOnly: boolean;
  /** Why this number can't post here (null/undefined = it can). */
  reason?: string | null;
  kind?: GroupKind;
  communityId?: string | null;
  communityName?: string | null;
  participants?: number | null;
}
export interface PresetGroup {
  id: string;
  name: string;
  available?: boolean;
}
export interface Preset {
  id: number;
  name: string;
  groups: PresetGroup[];
  userIds?: number[];
}
export interface Snippet {
  id: number;
  name: string;
  body: string;
}
export interface MessageLink {
  original: string;
  cleaned: string;
  host: string;
}
export interface AnalyzedLink extends MessageLink {
  allowed: boolean;
  /** Counts for duplicate detection (not a footer/repeating link). */
  main: boolean;
}
export interface ImageInfo {
  id: string;
  originalName: string;
  originalSize: number;
  originalType: string;
  originalSha256: string;
  processedSha256: string;
  size: number;
  width: number;
  height: number;
}
export type SendMode = 'text' | 'single' | 'two';
export interface Duplicate {
  jobId: number;
  at: number;
  groups: number;
  by: string;
  reasons: string[];
}
/** What /api/messages/check returns: exactly what would be sent, with every server check. */
export interface Analysis {
  text: string;
  sha256: string;
  chars: number;
  limit: number;
  tooLong: boolean;
  empty: boolean;
  links: AnalyzedLink[];
  disallowed: string[];
  mainLinks: string[];
  mode: SendMode;
  image: ImageInfo | null;
  imageError: string | null;
  duplicate: Duplicate | null;
}
export interface JobItem {
  id: number;
  groupId: string;
  groupName: string;
  status: ItemStatus;
  error: string | null;
  attemptedAt: number | null;
  connectionId: number | null;
}
export interface Job {
  id: number;
  userId: number;
  username: string;
  /** Old jobs: the post URL. New jobs: the first main link (may be ''). */
  url: string;
  /** Old jobs: facebook | tiktok | youtube. New jobs: 'message'. */
  platform: string;
  messageText: string | null;
  messageSha256: string | null;
  imageId: string | null;
  imageSha256: string | null;
  sendMode: SendMode | null;
  links: MessageLink[];
  warnings: Record<string, unknown> | null;
  connectionLabel: string | null;
  presetIds: number[];
  status: JobStatus;
  waitReason: WaitReason;
  parentJobId: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  items?: JobItem[];
}
export interface SendOptions {
  isAdmin: boolean;
  presets: Preset[];
  groups: Group[];
  snippets: Snippet[];
  allowedDomains: string[];
  limits: { text: number; caption: number; imageBytes: number };
  settings: SafetySettings;
  usage: Usage;
  sending: SendingStatus;
  queue: QueueStatus;
  timeZone: string;
}
export interface UserView {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  createdAt: number;
  presetIds: number[];
  activeSessions: number;
}
export interface ConnectionView {
  id: number;
  label: string;
  clientId: string;
  status: ConnectionStatus;
  isActive: boolean;
  phone: string | null;
  pushName: string | null;
  addedAt: number;
  addedByUsername: string | null;
  linkedAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  retiredAt: number | null;
  qr: string | null;
  running: boolean;
  nextRetryAt: number | null;
  sentToday: number;
  sentTotal: number;
}
export interface AuditRow {
  id: number;
  ts: number;
  actorUserId: number | null;
  actorUsername: string;
  actorRole: Role | null;
  ip: string | null;
  userAgent: string | null;
  sessionId: string | null;
  action: string;
  category: string;
  targetType: string | null;
  targetId: string | null;
  outcome: Outcome;
  reason: string | null;
  details: string | null;
  connectionId: number | null;
}

export interface MessagingSettings {
  allowedDomains: string[];
  repeatingLinks: string[];
}

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
  dailyCap: number;
  windowStart: string;
  windowEnd: string;
}
export interface Group {
  id: string;
  name: string;
  readOnly: boolean;
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
export interface Template {
  id: number;
  name: string;
  body: string;
  active: boolean;
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
  url: string;
  platform: Platform;
  templateId: number | null;
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
  templates: Template[];
  settings: SafetySettings;
  usage: Usage;
  sending: SendingStatus;
  queue: QueueStatus;
  timeZone: string;
}
export interface LinkCheck {
  ok: boolean;
  error?: string;
  url?: string;
  platform?: Platform;
  previous?: { jobId: number; at: number; groups: number; by: string } | null;
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

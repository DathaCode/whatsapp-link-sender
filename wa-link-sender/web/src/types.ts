export type Platform = 'facebook' | 'tiktok' | 'youtube';
export type WaState = 'starting' | 'qr' | 'authenticating' | 'ready' | 'reconnecting' | 'stopped';
export type JobStatus = 'queued' | 'running' | 'waiting' | 'done' | 'cancelled';
export type WaitReason = 'whatsapp_offline' | 'outside_hours' | 'daily_cap' | null;
export type ItemStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface WaStatus {
  state: WaState;
  qr: string | null;
  account: { name: string; phone: string } | null;
  lastError: string | null;
  nextRetryAt: number | null;
  since: number;
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
export interface Preset {
  id: number;
  name: string;
  groupIds: string[];
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
}
export interface Job {
  id: number;
  url: string;
  platform: Platform;
  templateId: number | null;
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
export interface Bootstrap {
  whatsapp: WaStatus;
  queue: QueueStatus;
  usage: Usage;
  settings: SafetySettings;
  defaults: SafetySettings;
  timeZone: string;
  groups: Group[];
  presets: Preset[];
  templates: Template[];
  activeJobs: Job[];
}
export interface LinkCheck {
  ok: boolean;
  error?: string;
  url?: string;
  platform?: Platform;
  previous?: { jobId: number; at: number; groups: number } | null;
}

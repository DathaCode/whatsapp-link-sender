import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { inWindow, localTime } from '../src/time.js';


describe('sending hours', () => {
  it('same-day window', () => {
    expect(inWindow(8 * 60, '08:00', '21:00')).toBe(true);
    expect(inWindow(21 * 60, '08:00', '21:00')).toBe(false);
    expect(inWindow(7 * 60 + 59, '08:00', '21:00')).toBe(false);
  });
  it('window crossing midnight', () => {
    expect(inWindow(23 * 60, '20:00', '02:00')).toBe(true);
    expect(inWindow(60, '20:00', '02:00')).toBe(true);
    expect(inWindow(3 * 60, '20:00', '02:00')).toBe(false);
  });
  it('local time uses the configured zone', () => {
    // 2026-01-01T20:00Z is 01:30 on Jan 2 in Colombo (UTC+5:30)
    expect(localTime(new Date('2026-01-01T20:00:00Z'), 'Asia/Colombo')).toEqual({ day: '2026-01-02', minutes: 90 });
  });
});

describe('config', () => {
  const base = { SESSION_SECRET: 'x'.repeat(40) };
  it('applies defaults', () => {
    const r = parseConfig(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.PORT).toBe(3100);
    expect(r.config.TZ).toBe('Asia/Colombo');
    expect(r.config.MIN_DELAY_SECONDS).toBe(15);
    expect(r.config.SESSION_IDLE_HOURS).toBe(8);
    expect(r.config.SESSION_MAX_DAYS).toBe(7);
    expect(r.config.LOGIN_MAX_ATTEMPTS).toBe(5);
    expect(r.config.LOGIN_LOCK_MINUTES).toBe(15);
    expect(r.config.AUDIT_RETENTION_DAYS).toBe(365);
    expect(r.config.BACKUP_KEEP).toBe(14);
    expect(r.config.TRUST_PROXY).toBe('loopback, uniquelocal');
  });
  it('reports clear errors', () => {
    const r = parseConfig({ SESSION_SECRET: 'short', MIN_DELAY_SECONDS: '50', MAX_DELAY_SECONDS: '10', TZ: 'Mars/Base', SEND_WINDOW_START: '8am', INITIAL_ADMIN_PASSWORD: 'short' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const all = r.errors.join(' | ');
      expect(all).toMatch(/SESSION_SECRET must be at least 32/);
      expect(all).toMatch(/TZ is not a valid time zone/);
      expect(all).toMatch(/SEND_WINDOW_START must look like 08:00/);
      expect(all).toMatch(/INITIAL_ADMIN_PASSWORD must be at least 10/);
    }
  });
  it('requires SESSION_SECRET', () => {
    expect(parseConfig({}).ok).toBe(false);
  });
  it('parses TRUST_PROXY forms', () => {
    const v = (t: string) => {
      const r = parseConfig({ ...base, TRUST_PROXY: t });
      return r.ok ? r.config.TRUST_PROXY : 'ERR';
    };
    expect(v('true')).toBe(true);
    expect(v('false')).toBe(false);
    expect(v('1')).toBe(1);
    expect(v('10.0.0.0/8')).toBe('10.0.0.0/8');
  });
  it('keeps audit retention at 30 days or more', () => {
    expect(parseConfig({ ...base, AUDIT_RETENTION_DAYS: '7' }).ok).toBe(false);
  });
});

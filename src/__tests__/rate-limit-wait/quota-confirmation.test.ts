import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DaemonConfig, DaemonState, RateLimitStatus } from '../../features/rate-limit-wait/types.js';

const boundary = vi.hoisted(() => ({ check: vi.fn(), resume: vi.fn(() => true) }));
vi.mock('../../features/rate-limit-wait/rate-limit-monitor.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../features/rate-limit-wait/rate-limit-monitor.js')>(),
  checkRateLimitStatus: boundary.check,
}));
vi.mock('../../features/rate-limit-wait/tmux-detector.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../features/rate-limit-wait/tmux-detector.js')>(),
  isTmuxAvailable: () => false,
  sendResumeSequence: boundary.resume,
}));
import { pollLoop, shouldResumeBlockedPanesOnStatusChange } from '../../features/rate-limit-wait/daemon.js';

function status(limited: boolean, degraded = false): RateLimitStatus {
  return {
    fiveHourLimited: limited, weeklyLimited: false, monthlyLimited: false, isLimited: limited,
    fiveHourResetsAt: null, weeklyResetsAt: null, monthlyResetsAt: null,
    nextResetAt: null, timeUntilResetMs: null, lastCheckedAt: new Date(),
    ...(degraded ? { apiErrorReason: 'rate_limited' as const, usingStaleData: true } : {}),
  };
}

describe('confirmed quota transitions in the actual daemon polling loop', () => {
  let root: string;
  let config: Required<DaemonConfig>;
  let listeners: Map<'SIGINT' | 'SIGTERM' | 'exit', unknown[]>;
  beforeEach(() => {
    vi.useFakeTimers();
    boundary.check.mockReset();
    boundary.resume.mockClear();
    root = mkdtempSync(join(tmpdir(), 'omc-quota-confirmation-'));
    config = { pollIntervalMs: 1000, paneLinesToCapture: 15, verbose: false,
      stateFilePath: join(root, 'state.json'), pidFilePath: join(root, 'pid'), logFilePath: join(root, 'log') };
    const events = ['SIGINT', 'SIGTERM', 'exit'] as const;
    listeners = new Map(events.map(event => [event,
      event === 'exit' ? process.listeners('exit') : process.listeners(event),
    ]));
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    for (const [event, original] of listeners) {
      for (const listener of (event === 'exit' ? process.listeners('exit') : process.listeners(event))) {
        if (!original.includes(listener)) process.removeListener(event, listener);
      }
    }
    rmSync(root, { recursive: true, force: true });
  });
  function seed(previous: RateLimitStatus | null, flag?: unknown): void {
    const state = { isRunning: true, pid: null, startedAt: new Date(), lastPollAt: null,
      rateLimitStatus: previous, blockedPanes: [{ id: '%test', session: 'isolated', windowIndex: 0,
        windowName: 'test', paneIndex: 0, isActive: false, firstDetectedAt: new Date(),
        analysis: { hasClaudeCode: true, hasRateLimitMessage: true, isBlocked: true, confidence: 1 },
        resumeAttempted: false }], resumedPaneIds: [], totalResumeAttempts: 0,
      successfulResumes: 0, errorCount: 0,
      ...(flag === undefined ? {} : { lastConfirmedLimited: flag }) };
    writeFileSync(config.stateFilePath, JSON.stringify(state));
  }
  function observed(): DaemonState {
    return JSON.parse(readFileSync(config.stateFilePath, 'utf8'));
  }
  async function start(sample: RateLimitStatus | null): Promise<void> {
    boundary.check.mockResolvedValue(sample);
    // Run bounded iterations; cleanup cancels the loop's pending fake timer.
    void pollLoop(config);
    await vi.advanceTimersByTimeAsync(0);
  }
  async function next(sample: RateLimitStatus | null): Promise<void> {
    boundary.check.mockResolvedValue(sample);
    await vi.advanceTimersByTimeAsync(1000);
  }
  it('requires a non-null confirmed all-clear at the public transition boundary', () => {
    expect(shouldResumeBlockedPanesOnStatusChange(status(true), null)).toBe(false);
    expect(shouldResumeBlockedPanesOnStatusChange(status(true), status(false, true))).toBe(false);
    expect(shouldResumeBlockedPanesOnStatusChange(status(true), status(false))).toBe(true);
  });
  it('preserves limited history through unavailable and degraded samples, including restart', async () => {
    seed(status(true));
    await start(null);
    expect(boundary.resume).not.toHaveBeenCalled();
    expect(observed().rateLimitStatus).toBeNull();
    expect(observed().lastConfirmedLimited).toBe(true);
    await next(status(false, true));
    expect(boundary.resume).not.toHaveBeenCalled();
    expect(observed().rateLimitStatus?.apiErrorReason).toBe('rate_limited');
    expect(observed().lastConfirmedLimited).toBe(true);
    // Simulate restart using the actual persisted state; the old loop stays suspended.
    vi.clearAllTimers();
    await start(null);
    expect(boundary.resume).not.toHaveBeenCalled();
    await next(status(false));
    expect(boundary.resume).toHaveBeenCalledExactlyOnceWith('%test');
    expect(observed().successfulResumes).toBe(1);
    expect(observed().lastConfirmedLimited).toBe(false);
    await next(status(false));
    expect(boundary.resume).toHaveBeenCalledTimes(1);
  });
  it('preserves confirmed limited history through a degraded sample without an unavailable poll', async () => {
    seed(status(true));
    await start(status(false, true));
    expect(boundary.resume).not.toHaveBeenCalled();
    expect(observed().rateLimitStatus?.apiErrorReason).toBe('rate_limited');
    await next(status(false));
    expect(boundary.resume).toHaveBeenCalledExactlyOnceWith('%test');
  });
  it('recovers through an initially stale limited sample', async () => {
    seed(null, false);
    await start(status(true, true));
    expect(boundary.resume).not.toHaveBeenCalled();
    expect(observed().lastConfirmedLimited).toBe(true);
    await next(status(false));
    expect(boundary.resume).toHaveBeenCalledExactlyOnceWith('%test');
  });
  it('recovers legacy persisted stale limited status without the new flag', async () => {
    seed(status(true, true));
    await start(status(false));
    expect(boundary.resume).toHaveBeenCalledExactlyOnceWith('%test');
  });
  it('does not trust a nonboolean flag when the last observation is unconfirmed', async () => {
    seed(status(false, true), 'true');
    await start(null);
    await next(status(false));
    expect(boundary.resume).not.toHaveBeenCalled();
  });
  it.each([null, status(false)])('does not resume without confirmed prior exhaustion: %j', async previous => {
    seed(previous);
    await start(null);
    await next(status(false));
    expect(boundary.resume).not.toHaveBeenCalled();
    expect(observed().successfulResumes).toBe(0);
  });
  it('ignores nonboolean persisted flags and recovers legacy confirmed limited status', async () => {
    seed(status(true), 'false');
    await start(null);
    expect(boundary.resume).not.toHaveBeenCalled();
    await next(status(false));
    expect(boundary.resume).toHaveBeenCalledExactlyOnceWith('%test');
  });
});

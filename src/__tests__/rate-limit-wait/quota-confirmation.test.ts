import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getClaudeConfigDir } from '../../utils/config-dir.js';
import type { BlockedPane, DaemonConfig, DaemonState, RateLimitStatus } from '../../features/rate-limit-wait/types.js';

const boundary = vi.hoisted(() => ({
  check: vi.fn(),
  resume: vi.fn(() => true),
  scan: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('../../features/rate-limit-wait/rate-limit-monitor.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../features/rate-limit-wait/rate-limit-monitor.js')>(),
  checkRateLimitStatus: boundary.check,
}));
vi.mock('../../features/rate-limit-wait/tmux-detector.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../features/rate-limit-wait/tmux-detector.js')>(),
  isTmuxAvailable: () => true,
  scanForBlockedPanes: boundary.scan,
  revalidateBlockedPanes: boundary.revalidate,
  sendResumeSequence: boundary.resume,
}));
import { pollLoop, shouldResumeBlockedPanesOnStatusChange } from '../../features/rate-limit-wait/daemon.js';

function currentUsageProfileHash(): string {
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  const credentialIdentity = oauthToken
    ? createHash('sha256').update(oauthToken).digest('hex')
    : null;
  return createHash('sha256')
    .update(JSON.stringify([
      process.env.CLAUDE_CONFIG_DIR ?? null,
      getClaudeConfigDir(),
      credentialIdentity,
    ]))
    .digest('hex');
}

function status(limited: boolean, degraded = false): RateLimitStatus {
  return {
    fiveHourLimited: limited, weeklyLimited: false, monthlyLimited: false, isLimited: limited,
    fiveHourResetsAt: null, weeklyResetsAt: null, monthlyResetsAt: null,
    nextResetAt: null, timeUntilResetMs: null, lastCheckedAt: new Date(),
    ...(degraded ? { apiErrorReason: 'rate_limited' as const, usingStaleData: true } : {}),
  };
}

function staleNetworkStatus(limited: boolean): RateLimitStatus {
  return { ...status(limited), apiErrorReason: 'network', usingStaleData: true };
}

function blockedPane(overrides: Partial<BlockedPane> = {}): BlockedPane {
  return {
    id: '%test', session: 'isolated', windowIndex: 0, windowName: 'test', paneIndex: 0,
    isActive: false, firstDetectedAt: new Date(),
    analysis: { hasClaudeCode: true, hasRateLimitMessage: true, isBlocked: true, confidence: 1 },
    resumeAttempted: false,
    ...overrides,
  };
}

describe('confirmed quota transitions in the actual daemon polling loop', () => {
  let root: string;
  let config: Required<DaemonConfig>;
  let listeners: Map<'SIGINT' | 'SIGTERM' | 'exit', unknown[]>;
  let originalConfigDir: string | undefined;
  let originalOAuthToken: string | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    boundary.check.mockReset();
    boundary.resume.mockClear();
    boundary.scan.mockReset();
    boundary.scan.mockReturnValue([blockedPane()]);
    boundary.revalidate.mockReset();
    boundary.revalidate.mockReturnValue([blockedPane()]);
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    originalOAuthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
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
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    if (originalOAuthToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = originalOAuthToken;
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
      usageProfileHash: currentUsageProfileHash(),
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
  it('retains restored pane candidates through a limited poll with no new pane output', async () => {
    seed(status(true));
    boundary.scan.mockReturnValueOnce([]);
    await start(status(true));
    expect(observed().blockedPanes).toMatchObject([{ id: '%test' }]);
    expect(boundary.resume).not.toHaveBeenCalled();
    await next(status(false));
    expect(boundary.revalidate).toHaveBeenCalledOnce();
    expect(boundary.resume).toHaveBeenCalledExactlyOnceWith('%test');
  });
  it('does not resume on stale cached clear after a network failure', async () => {
    seed(status(true));
    await start(staleNetworkStatus(false));
    expect(boundary.resume).not.toHaveBeenCalled();
    expect(observed().lastConfirmedLimited).toBe(true);
    expect(observed().rateLimitStatus?.usingStaleData).toBe(true);
    await next(status(false));
    expect(boundary.resume).toHaveBeenCalledExactlyOnceWith('%test');
  });
  it('does not resume a restored pane after its saved location has changed', async () => {
    seed(status(true));
    await start(null);
    boundary.revalidate.mockReturnValue([blockedPane({ session: 'reused-session' })]);
    await next(status(false));
    expect(boundary.resume).not.toHaveBeenCalled();
    expect(observed().successfulResumes).toBe(0);
  });
  it('retains panes after inconclusive revalidation and retries on the next clear poll', async () => {
    seed(status(true));
    await start(null);
    boundary.revalidate.mockReturnValueOnce(null).mockReturnValue([blockedPane()]);
    await next(status(false));
    expect(boundary.resume).not.toHaveBeenCalled();
    expect(observed().blockedPanes).toHaveLength(1);
    await next(status(false));
    expect(boundary.resume).toHaveBeenCalledExactlyOnceWith('%test');
    expect(observed().blockedPanes).toEqual([]);
  });
  it('does not carry quota state across Claude config profiles', async () => {
    seed(status(true));
    process.env.CLAUDE_CONFIG_DIR = `${process.env.CLAUDE_CONFIG_DIR ?? ''}-other-profile`;
    await start(status(false));
    expect(boundary.resume).not.toHaveBeenCalled();
    expect(observed().lastConfirmedLimited).toBe(false);
    expect(observed().blockedPanes).toEqual([]);
    expect(observed().usageProfileHash).toBe(currentUsageProfileHash());
  });
  it('does not carry quota state across direct OAuth credential changes', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'profile-a-token';
    seed(status(true));
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'profile-b-token';
    await start(status(false));
    expect(boundary.resume).not.toHaveBeenCalled();
    expect(observed().lastConfirmedLimited).toBe(false);
    expect(observed().blockedPanes).toEqual([]);
    expect(observed().usageProfileHash).toBe(currentUsageProfileHash());
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

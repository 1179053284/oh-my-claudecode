import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { purgeStalePluginCacheVersions } from '../paths.js';
import { processStartIdentities, publishCacheOccupancy, readOccupiedPluginRoots } from '../cache-occupancy.js';

const readFailures = vi.hoisted(() => new Map<string, string>());
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: vi.fn((...args: Parameters<typeof actual.readFileSync>) => {
      const code = readFailures.get(String(args[0]));
      if (code) throw Object.assign(new Error(code), { code });
      return actual.readFileSync(...args);
    }),
  };
});

describe('cache occupancy registry', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'omc-occupancy-')); });
  afterEach(() => { vi.unstubAllEnvs(); readFailures.clear(); rmSync(dir, { recursive: true, force: true }); });

  it.each([
    ['typescript', null],
    ['script', '../../../scripts/lib/cache-occupancy.mjs'],
    ['template', '../../../templates/hooks/lib/cache-occupancy.mjs'],
  ].flatMap(([name, path]) => ['EACCES', 'EIO'].map(code => [name, path, code]))) (
    'retains unreadable live records in %s for %s (%s)', async (_name, path, code) => {
    const read = path ? (await import(path)).readOccupiedPluginRoots : readOccupiedPluginRoots;
    const root = join(dir, 'plugins', '1.0.0');
    mkdirSync(root, { recursive: true });
    expect(await publishCacheOccupancy(root, dir)).toBe(true);
    const registry = join(dir, '.omc', 'cache-occupancy');
    const recordPath = join(registry, readdirSync(registry)[0]);
    readFailures.set(recordPath, code!);

    expect.soft(read(dir).unavailable).toBe(true);
    expect.soft(existsSync(recordPath)).toBe(true);
    readFailures.clear();
    expect(read(dir).roots).toEqual(new Set([root]));
  });

  it.each(['EACCES', 'EIO'])('preserves a live pinned cache version when its record reports %s', async code => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', dir);
    const root = join(dir, 'plugins', 'cache', 'omc', 'oh-my-claudecode', '1.0.0');
    mkdirSync(join(root, 'hooks'), { recursive: true });
    mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, 'hooks', 'hooks.json'), '{}');
    writeFileSync(join(root, 'scripts', 'run.cjs'), '// fixture');
    writeFileSync(join(dir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {} }));
    const old = new Date(Date.now() - 26 * 60 * 60 * 1000);
    utimesSync(root, old, old);
    expect(await publishCacheOccupancy(root, dir)).toBe(true);
    const registry = join(dir, '.omc', 'cache-occupancy');
    const recordPath = join(registry, readdirSync(registry)[0]);
    readFailures.set(recordPath, code);

    const result = purgeStalePluginCacheVersions();

    expect.soft(result.removed).toBe(0);
    expect.soft(result.skippedPaths).toContain(root);
    expect.soft(existsSync(join(root, 'scripts', 'run.cjs'))).toBe(true);
    expect(existsSync(recordPath)).toBe(true);
  });

  it.each(['../../../scripts/lib/cache-occupancy.mjs', '../../../templates/hooks/lib/cache-occupancy.mjs'])(
    'preserves corruption cleanup and concurrent-disappearance behavior in %s', async path => {
      const { readOccupiedPluginRoots: read } = await import(path);
      const registry = join(dir, '.omc', 'cache-occupancy');
      mkdirSync(registry, { recursive: true });
      const recordPath = join(registry, `${'a'.repeat(64)}.json`);
      writeFileSync(recordPath, '{broken');
      expect(read(dir).unavailable).toBe(false);
      expect(existsSync(recordPath)).toBe(false);
      writeFileSync(recordPath, '{}');
      readFailures.set(recordPath, 'ENOENT');
      expect(read(dir).unavailable).toBe(false);
      expect(existsSync(recordPath)).toBe(true);
    },
  );

  it('treats a concurrently disappeared TypeScript record as available', () => {
    const registry = join(dir, '.omc', 'cache-occupancy');
    mkdirSync(registry, { recursive: true });
    const recordPath = join(registry, `${'a'.repeat(64)}.json`);
    writeFileSync(recordPath, '{}');
    readFailures.set(recordPath, 'ENOENT');
    expect(readOccupiedPluginRoots(dir).unavailable).toBe(false);
    expect(existsSync(recordPath)).toBe(true);
  });

  it('publishes an atomic, privacy-bounded record and reads the occupied root', async () => {
    const root = join(dir, 'plugins', '1.0.0');
    mkdirSync(root, { recursive: true });
    expect(await publishCacheOccupancy(root, dir)).toBe(true);
    const result = readOccupiedPluginRoots(dir);
    expect(result.unavailable).toBe(false);
    expect(result.roots).toEqual(new Set([root]));
    const files = readdirSync(join(dir, '.omc', 'cache-occupancy'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
  });

  it('drops corrupt records without exposing their contents', () => {
    const registry = join(dir, '.omc', 'cache-occupancy');
    mkdirSync(registry, { recursive: true });
    writeFileSync(join(registry, `${'a'.repeat(64)}.json`), '{broken');
    expect(readOccupiedPluginRoots(dir).roots.size).toBe(0);
    expect(readdirSync(registry)).toEqual([]);
  });

  it('resolves Windows process identities in one PowerShell call', () => {
    const originalPlatform = process.platform;
    const exec = vi.fn(() => JSON.stringify([
      { Id: 41, StartTicks: '638933184000000001' },
      { Id: 42, StartTicks: '638933184000000002' },
    ])) as unknown as Parameters<typeof processStartIdentities>[1];
    try {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      expect(processStartIdentities([41, 42, 41], exec)).toEqual(new Map([
        [41, 'ticks:638933184000000001'],
        [42, 'ticks:638933184000000002'],
      ]));
      expect(exec).toHaveBeenCalledTimes(1);
      expect(exec).toHaveBeenCalledWith(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', expect.stringContaining("[string]$_.StartTime.ToUniversalTime().Ticks")],
        { encoding: 'utf8', windowsHide: true },
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('accepts a single realistic Windows identity and rejects numeric precision loss', () => {
    const originalPlatform = process.platform;
    const exec = vi.fn(() => JSON.stringify({ Id: 41, StartTicks: '638933184000000001' })) as unknown as Parameters<typeof processStartIdentities>[1];
    try {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      expect(processStartIdentities([41], exec)).toEqual(new Map([[41, 'ticks:638933184000000001']]));

      const rounded = vi.fn(() => JSON.stringify({ Id: 41, StartTicks: Number('638933184000000001') })) as unknown as Parameters<typeof processStartIdentities>[1];
      expect(processStartIdentities([41], rounded)).toEqual(new Map());
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('publish skips its per-process probe when handed a precomputed identity (#3995)', async () => {
    const root = join(dir, 'plugins', '2.0.0');
    mkdirSync(root, { recursive: true });
    const originalPlatform = process.platform;
    try {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      // A deliberately corrupt precomputed identity would only be accepted
      // verbatim if publish skipped its own probe; the record must carry it
      // untouched (verification happens on read via the identity map).
      expect(await publishCacheOccupancy(root, dir, 'ticks:638933184000000001')).toBe(true);
      // The map-backed read verifies the record without any further probe.
      const result = readOccupiedPluginRoots(dir, { identities: new Map([[process.pid, 'ticks:638933184000000001']]) });
      expect(result.unavailable).toBe(false);
      expect(result.roots).toEqual(new Set([root.toLowerCase()]));
      // A mismatched identity in the map invalidates the record; omitting the
      // map falls back to a fresh batched probe. Both verification paths agree
      // the record is only kept on proven-fresh or unknown identity.
      const mismatched = readOccupiedPluginRoots(dir, { identities: new Map([[process.pid, 'ticks:638933184000000002']]) });
      expect(mismatched.roots.size).toBe(0);
      expect(mismatched.identities.get(process.pid)).toBe('ticks:638933184000000002');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});

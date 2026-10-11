/** Real-filesystem regressions for cache targets whose payload is symlinked. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync,
  existsSync, lstatSync, readdirSync, readlinkSync, utimesSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let configDir: string;
vi.mock('../utils/config-dir.js', () => ({
  getClaudeConfigDir: vi.fn(() => configDir),
}));

const { purgeStalePluginCacheVersions } = await import('../utils/paths.js');

const PLUGIN = 'omc/oh-my-claudecode';
const STALE = '4.15.6';
const ACTIVE = '4.15.10';
let pluginDir: string;

function makeStale(path: string): void {
  const old = new Date(Date.now() - 26 * 60 * 60 * 1000);
  utimesSync(path, old, old);
}

function writeVersion(version: string): string {
  const directory = join(pluginDir, version);
  mkdirSync(join(directory, 'scripts'), { recursive: true });
  writeFileSync(join(directory, 'scripts', 'run.cjs'), `// ${version}\n`);
  mkdirSync(join(directory, 'hooks'), { recursive: true });
  writeFileSync(join(directory, 'hooks', 'hooks.json'), '{}\n');
  return directory;
}

function installPath(path = join(pluginDir, ACTIVE)): void {
  writeFileSync(join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2, plugins: { 'oh-my-claudecode@omc': [{ installPath: path, version: ACTIVE }] },
  }));
}

function stubOwnerLiveness(): void {
  vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
    if (pid === process.pid) return true;
    const error = new Error('ESRCH') as NodeJS.ErrnoException;
    error.code = 'ESRCH';
    throw error;
  }) as unknown as typeof process.kill);
}

beforeEach(() => {
  stubOwnerLiveness();
  configDir = mkdtempSync(join(tmpdir(), 'omc-cache-link-'));
  pluginDir = join(configDir, 'plugins', 'cache', PLUGIN);
  mkdirSync(pluginDir, { recursive: true });
  writeVersion(ACTIVE);
  installPath();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(configDir, { recursive: true, force: true });
});

describe('purgeStalePluginCacheVersions symlink payload validation', () => {
  it('preserves OMC payload when a required entry point links into the stale tree', () => {
    const stale = writeVersion(STALE);
    const staleScript = join(stale, 'payload', 'run.cjs');
    const active = join(pluginDir, ACTIVE);
    const activeScript = join(active, 'scripts', 'run.cjs');
    mkdirSync(join(stale, 'payload'), { recursive: true });
    writeFileSync(staleScript, '// only stale entrypoint');
    mkdirSync(join(active, 'hooks'), { recursive: true });
    writeFileSync(join(active, 'hooks', 'hooks.json'), '{}\n');
    mkdirSync(join(active, 'scripts'), { recursive: true });
    mkdirSync(join(active, 'payload'), { recursive: true });
    writeFileSync(join(active, 'payload', 'run.cjs'), '// active counterpart');
    rmSync(activeScript, { force: true });
    symlinkSync(staleScript, activeScript, 'file');
    makeStale(stale);
    installPath(active);

    const result = purgeStalePluginCacheVersions();

    expect(result.symlinked).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(lstatSync(stale).isDirectory()).toBe(true);
    expect(readlinkSync(activeScript)).toBe(staleScript);
    expect(existsSync(activeScript)).toBe(true);
    expect(readdirSync(pluginDir).filter(name => name.includes('.omc-stale-'))).toEqual([]);
  });

  it('preserves generic payload when a child symlink traverses the stale version', () => {
    const genericDir = join(configDir, 'plugins', 'cache', 'official', 'hookify');
    const active = join(genericDir, ACTIVE);
    const stale = join(genericDir, STALE);
    const staleCommands = join(stale, 'commands');
    const activeCommands = join(active, 'commands');
    mkdirSync(active, { recursive: true });
    writeFileSync(join(active, 'README.md'), 'active generic payload');
    mkdirSync(staleCommands, { recursive: true });
    writeFileSync(join(staleCommands, 'old-command.js'), 'old payload');
    writeFileSync(join(stale, 'README.md'), 'old generic payload');
    symlinkSync(staleCommands, activeCommands, 'dir');
    makeStale(stale);
    writeFileSync(join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2, plugins: { 'hookify@official': [{ installPath: active }] },
    }));

    const result = purgeStalePluginCacheVersions();

    expect(result.symlinked).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(lstatSync(stale).isDirectory()).toBe(true);
    expect(existsSync(join(stale, 'commands', 'old-command.js'))).toBe(true);
    expect(readlinkSync(activeCommands)).toBe(staleCommands);
    expect(readdirSync(genericDir).filter(name => name.includes('.omc-stale-'))).toEqual([]);
  });

  it('preserves generic payload when a resolvable link aliases stale data', () => {
    const genericDir = join(configDir, 'plugins', 'cache', 'official', 'hookify');
    const active = join(genericDir, ACTIVE);
    const stale = join(genericDir, STALE);
    const activePayload = join(active, 'payload');
    const stalePayload = join(stale, 'payload');
    const legacyPayload = join(active, 'legacy');
    mkdirSync(activePayload, { recursive: true });
    writeFileSync(join(activePayload, 'current-command.js'), 'current payload');
    mkdirSync(stalePayload, { recursive: true });
    writeFileSync(join(stalePayload, 'legacy-command.js'), 'only stale payload');
    writeFileSync(join(active, 'README.md'), 'active generic payload');
    writeFileSync(join(stale, 'README.md'), 'old generic payload');
    symlinkSync(stalePayload, legacyPayload, 'dir');
    makeStale(stale);
    writeFileSync(join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2, plugins: { 'hookify@official': [{ installPath: active }] },
    }));

    const result = purgeStalePluginCacheVersions();

    expect(result.symlinked).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(lstatSync(stale).isDirectory()).toBe(true);
    expect(existsSync(join(legacyPayload, 'legacy-command.js'))).toBe(true);
    expect(readlinkSync(legacyPayload)).toBe(stalePayload);
    expect(readdirSync(genericDir).filter(name => name.includes('.omc-stale-'))).toEqual([]);
  });

  it('preserves generic payload when an intermediate link traverses the stale tree', () => {
    const genericDir = join(configDir, 'plugins', 'cache', 'official', 'hookify');
    const active = join(genericDir, ACTIVE);
    const stale = join(genericDir, STALE);
    const oldRoot = join(configDir, 'external-old-root');
    const newRoot = join(configDir, 'external-new-root');
    const staleForward = join(stale, 'forward');
    const activeForward = join(active, 'forward');
    const activeLegacy = join(active, 'legacy');
    mkdirSync(active, { recursive: true });
    writeFileSync(join(active, 'README.md'), 'generic plugin payload');
    mkdirSync(oldRoot, { recursive: true });
    writeFileSync(join(oldRoot, 'legacy-command.js'), 'old payload');
    mkdirSync(newRoot, { recursive: true });
    writeFileSync(join(newRoot, 'legacy-command.js'), 'new payload');
    mkdirSync(stale, { recursive: true });
    symlinkSync(oldRoot, staleForward, 'dir');
    symlinkSync(newRoot, activeForward, 'dir');
    symlinkSync(staleForward, activeLegacy, 'dir');
    makeStale(stale);
    writeFileSync(join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2, plugins: { 'hookify@official': [{ installPath: active }] },
    }));

    const result = purgeStalePluginCacheVersions();

    expect(result.symlinked).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(lstatSync(stale).isDirectory()).toBe(true);
    expect(readFileSync(join(activeLegacy, 'legacy-command.js'), 'utf8')).toBe('old payload');
    expect(readlinkSync(activeLegacy)).toBe(staleForward);
    expect(readlinkSync(staleForward)).toBe(oldRoot);
    expect(readdirSync(genericDir).filter(name => name.includes('.omc-stale-'))).toEqual([]);
  });

  it('preserves generic payload when a directory symlink contains a stale-version link', () => {
    const genericDir = join(configDir, 'plugins', 'cache', 'official', 'hookify');
    const active = join(genericDir, ACTIVE);
    const stale = join(genericDir, STALE);
    const externalPayload = join(configDir, 'external-generic-payload');
    const staleData = join(stale, 'data');
    const externalChild = join(externalPayload, 'child');
    const activePayload = join(active, 'payload');
    mkdirSync(active, { recursive: true });
    writeFileSync(join(active, 'README.md'), 'active generic payload');
    mkdirSync(stale, { recursive: true });
    writeFileSync(staleData, 'only old data');
    mkdirSync(externalPayload, { recursive: true });
    symlinkSync(staleData, externalChild, 'file');
    symlinkSync(externalPayload, activePayload, 'dir');
    writeFileSync(join(stale, 'README.md'), 'old generic payload');
    makeStale(stale);
    writeFileSync(join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2, plugins: { 'hookify@official': [{ installPath: active }] },
    }));

    const result = purgeStalePluginCacheVersions();

    expect(result.symlinked).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(lstatSync(stale).isDirectory()).toBe(true);
    expect(existsSync(staleData)).toBe(true);
    expect(readlinkSync(activePayload)).toBe(externalPayload);
    expect(readlinkSync(externalChild)).toBe(staleData);
    expect(readdirSync(genericDir).filter(name => name.includes('.omc-stale-'))).toEqual([]);
  });
});

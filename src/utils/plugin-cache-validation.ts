import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { existsSync, lstatSync, readlinkSync, readdirSync, statSync, type Stats } from 'fs';

/**
 * The hook runner's required entry points. Keep this aligned with isPluginRoot()
 * in scripts/run.cjs; a stale root is not a valid fallback for any of them.
 */
const PLUGIN_ROOT_REQUIREMENTS = [
  join('hooks', 'hooks.json'),
  join('scripts', 'run.cjs'),
  'scripts',
];

const OMC_PLUGIN_CACHE_IDENTITIES = new Set([
  'oh-my-claudecode@omc',
  'oh-my-claudecode@oh-my-claudecode',
]);

export function isOmcPluginCacheIdentity(pluginName: string, marketplace: string): boolean {
  return OMC_PLUGIN_CACHE_IDENTITIES.has(`${pluginName}@${marketplace}`.toLowerCase());
}

export function sameFileSystemIdentity(left: Stats, right: Stats): boolean {
  return typeof left.dev === 'number' && typeof left.ino === 'number' && left.ino !== 0 &&
    typeof right.dev === 'number' && typeof right.ino === 'number' && right.ino !== 0 &&
    left.dev === right.dev && left.ino === right.ino;
}

export function hasAncestorWithIdentity(path: string, identity: Stats): boolean {
  let currentPath = path;
  while (true) {
    if (sameFileSystemIdentity(statSync(currentPath), identity)) return true;
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) return false;
    currentPath = parentPath;
  }
}

export function firstChildBelowDirectoryIdentity(path: string, directoryIdentity: Stats): string | undefined {
  // Relative install paths retain the existing lexical-only matching semantics.
  if (!isAbsolute(path)) return undefined;
  let currentPath = resolve(path);
  while (true) {
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) return undefined;
    try {
      if (sameFileSystemIdentity(statSync(parentPath), directoryIdentity)) return basename(currentPath);
    } catch {
      // The registered version can be missing while its namespace still exists.
    }
    currentPath = parentPath;
  }
}

function pathTraversesFileSystemIdentity(
  path: string,
  identity: Stats,
  visitedLinks: Set<string> = new Set(),
): boolean {
  let currentPath = resolve(path);
  while (true) {
    try {
      if (sameFileSystemIdentity(statSync(currentPath), identity)) return true;
    } catch {
      // A missing suffix can still have an ancestor in the protected tree.
    }
    try {
      const linkStats = lstatSync(currentPath);
      if (linkStats.isSymbolicLink()) {
        const key = typeof linkStats.dev === 'number' && typeof linkStats.ino === 'number' && linkStats.ino !== 0
          ? `inode:${linkStats.dev}:${linkStats.ino}`
          : `path:${process.platform === 'win32' ? currentPath.toLowerCase() : currentPath}`;
        if (!visitedLinks.has(key)) {
          visitedLinks.add(key);
          const linkTarget = readlinkSync(currentPath);
          const resolvedTarget = isAbsolute(linkTarget)
            ? linkTarget
            : resolve(dirname(currentPath), linkTarget);
          if (pathTraversesFileSystemIdentity(resolvedTarget, identity, visitedLinks)) return true;
        }
      }
    } catch {
      // An unreadable link is rejected by the target's normal usability check.
    }
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) return false;
    currentPath = parentPath;
  }
}

/**
 * True when `path` is a usable plugin root. When supplied, the stale identity
 * also prevents required paths from traversing the version being demoted.
 */
export function isUsableVersionPath(path: string, staleVersionIdentity?: Stats): boolean {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    return false;
  }
  if (!stats.isDirectory() && !stats.isSymbolicLink()) return false;
  return PLUGIN_ROOT_REQUIREMENTS.every(required => {
    const requiredPath = join(path, required);
    return existsSync(requiredPath) &&
      (staleVersionIdentity === undefined || !pathTraversesFileSystemIdentity(requiredPath, staleVersionIdentity));
  });
}

function hasResolvableGenericPluginSymlinks(
  directory: string,
  staleVersionIdentity: Stats,
  ancestors: Stats[] = [],
  requireNonEmpty = false,
): boolean {
  const directoryStats = statSync(directory);
  if (ancestors.some(identity => sameFileSystemIdentity(directoryStats, identity))) return false;
  const branch = [...ancestors, directoryStats];
  const entries = readdirSync(directory, { withFileTypes: true });
  if (requireNonEmpty && entries.length === 0) return false;
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const entryStats = statSync(entryPath);
      if (pathTraversesFileSystemIdentity(entryPath, staleVersionIdentity)) return false;
      if (entryStats.isDirectory() && (branch.some(identity => sameFileSystemIdentity(entryStats, identity)) ||
          !hasResolvableGenericPluginSymlinks(entryPath, staleVersionIdentity, branch))) {
        return false;
      }
    } else if (entry.isDirectory() &&
        !hasResolvableGenericPluginSymlinks(entryPath, staleVersionIdentity, branch)) {
      return false;
    }
  }
  return true;
}

export function isUsableGenericPluginTarget(target: string, staleVersionIdentity: Stats): boolean {
  return hasResolvableGenericPluginSymlinks(target, staleVersionIdentity, [], true);
}

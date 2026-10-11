import { basename, dirname, isAbsolute, join, parse, resolve } from 'path';
import { existsSync, lstatSync, readlinkSync, readdirSync, statSync, type Stats } from 'fs';

/**
 * The hook runner's required entry points. Keep this aligned with isPluginRoot()
 * in scripts/run.cjs; a stale root is not a valid fallback for any of them.
 */
const PLUGIN_ROOT_REQUIREMENTS = [join('hooks', 'hooks.json'), join('scripts', 'run.cjs'), 'scripts'];

const OMC_PLUGIN_CACHE_IDENTITIES = new Set(['oh-my-claudecode@omc', 'oh-my-claudecode@oh-my-claudecode']);
const FILESYSTEM_JUNK_NAMES = new Set(['.ds_store', 'desktop.ini', 'thumbs.db']);

export function isOmcPluginCacheIdentity(pluginName: string, marketplace: string): boolean {
  return OMC_PLUGIN_CACHE_IDENTITIES.has(`${pluginName}@${marketplace}`.toLowerCase());
}

export function sameFileSystemIdentity(left: Stats, right: Stats): boolean {
  return (
    typeof left.dev === 'number' &&
    typeof left.ino === 'number' &&
    left.ino !== 0 &&
    typeof right.dev === 'number' &&
    typeof right.ino === 'number' &&
    right.ino !== 0 &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
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

/** Includes the server and share, which win32.parse omits for extended UNC roots. */
export function pathRootForTraversal(path: string): string {
  const extendedUnc = /^(\\\\\?\\UNC\\|\/\/\?\/UNC\/)([^\\/]+)[\\/]+([^\\/]+)(?:[\\/]|$)/i.exec(path);
  if (extendedUnc) {
    const separator = extendedUnc[1].includes('\\') ? '\\' : '/';
    return `${extendedUnc[1]}${extendedUnc[2]}${separator}${extendedUnc[3]}${separator}`;
  }
  return parse(path).root;
}

function pathTraversesFileSystemIdentity(path: string, identity: Stats): boolean {
  let currentPath: string;
  let components: string[];
  const splitComponents = (value: string, root: string): string[] =>
    value
      .slice(root.length)
      .split(process.platform === 'win32' ? /[\\/]+/ : /\/+/)
      .filter(Boolean);

  if (isAbsolute(path)) {
    const pathRoot = pathRootForTraversal(path);
    currentPath = process.platform === 'win32' && pathRoot === '\\' ? parse(resolve(path)).root : pathRoot;
    components = splitComponents(path, pathRoot);
  } else {
    const pathRoot = pathRootForTraversal(path);
    if (process.platform === 'win32' && pathRoot) {
      // Resolve the drive's current directory without normalizing the target components.
      const driveCwd = resolve(`${pathRoot}.`);
      const driveRoot = parse(driveCwd).root;
      currentPath = driveRoot;
      components = [...splitComponents(driveCwd, driveRoot), ...splitComponents(path, pathRoot)];
    } else {
      const cwd = process.cwd();
      const cwdRoot = parse(cwd).root;
      currentPath = cwdRoot;
      components = [...splitComponents(cwd, cwdRoot), ...splitComponents(path, pathRoot)];
    }
  }

  type TraversalStep = string | { endLink: string };
  const steps: TraversalStep[] = [];
  for (let index = components.length - 1; index >= 0; index--) steps.push(components[index]);
  const activeLinks = new Set<string>();

  try {
    if (sameFileSystemIdentity(lstatSync(currentPath), identity)) return true;
  } catch {
    return false;
  }

  while (steps.length > 0) {
    const step = steps.pop()!;
    if (typeof step !== 'string') {
      activeLinks.delete(step.endLink);
      continue;
    }
    if (step === '' || step === '.') continue;
    if (step === '..') {
      currentPath = dirname(currentPath);
      continue;
    }

    const nextPath = join(currentPath, step);
    let nextStats: Stats;
    try {
      nextStats = lstatSync(nextPath);
    } catch {
      // Earlier components have already been checked; a missing suffix cannot traverse a later link.
      return false;
    }
    if (!nextStats.isSymbolicLink()) {
      if (sameFileSystemIdentity(nextStats, identity)) return true;
      currentPath = nextPath;
      continue;
    }

    const linkKey =
      typeof nextStats.dev === 'number' && typeof nextStats.ino === 'number' && nextStats.ino !== 0
        ? `inode:${nextStats.dev}:${nextStats.ino}`
        : `path:${process.platform === 'win32' ? nextPath.toLowerCase() : nextPath}`;
    if (activeLinks.has(linkKey)) return false;
    let linkTarget: string;
    try {
      linkTarget = readlinkSync(nextPath);
    } catch {
      // An unreadable link is rejected by the target's normal usability check.
      return false;
    }

    activeLinks.add(linkKey);
    steps.push({ endLink: linkKey });
    const targetPathRoot = pathRootForTraversal(linkTarget);
    let targetComponents: string[];
    if (isAbsolute(linkTarget)) {
      currentPath =
        process.platform === 'win32' && targetPathRoot === '\\' ? parse(resolve(linkTarget)).root : targetPathRoot;
      targetComponents = splitComponents(linkTarget, targetPathRoot);
    } else if (process.platform === 'win32' && targetPathRoot) {
      const driveCwd = resolve(`${targetPathRoot}.`);
      const driveRoot = parse(driveCwd).root;
      currentPath = driveRoot;
      targetComponents = [...splitComponents(driveCwd, driveRoot), ...splitComponents(linkTarget, targetPathRoot)];
    } else {
      targetComponents = splitComponents(linkTarget, targetPathRoot);
    }
    for (let index = targetComponents.length - 1; index >= 0; index--) steps.push(targetComponents[index]);
  }

  return false;
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
  const hasRequiredEntries = PLUGIN_ROOT_REQUIREMENTS.every((required) => {
    const requiredPath = join(path, required);
    return (
      existsSync(requiredPath) &&
      (staleVersionIdentity === undefined || !pathTraversesFileSystemIdentity(requiredPath, staleVersionIdentity))
    );
  });
  return (
    hasRequiredEntries &&
    (staleVersionIdentity === undefined || hasResolvablePluginSymlinks(path, staleVersionIdentity))
  );
}

interface PayloadScan {
  found: boolean;
}

function hasResolvablePluginSymlinks(
  directory: string,
  staleVersionIdentity: Stats,
  ancestors: Stats[] = [],
  payload?: PayloadScan,
): boolean {
  const directoryStats = statSync(directory);
  if (ancestors.some((identity) => sameFileSystemIdentity(directoryStats, identity))) return false;
  const branch = [...ancestors, directoryStats];
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const entryStats = statSync(entryPath);
      if (pathTraversesFileSystemIdentity(entryPath, staleVersionIdentity)) return false;
      if (entryStats.isDirectory()) {
        if (branch.some((identity) => sameFileSystemIdentity(entryStats, identity))) continue;
        if (!hasResolvablePluginSymlinks(entryPath, staleVersionIdentity, branch, payload)) return false;
      } else if (payload && entryStats.isFile() && !FILESYSTEM_JUNK_NAMES.has(entry.name.toLowerCase())) {
        payload.found = true;
      }
    } else if (entry.isDirectory()) {
      if (!hasResolvablePluginSymlinks(entryPath, staleVersionIdentity, branch, payload)) return false;
    } else if (payload && entry.isFile() && !FILESYSTEM_JUNK_NAMES.has(entry.name.toLowerCase())) {
      payload.found = true;
    }
  }
  return true;
}

export function isUsableGenericPluginTarget(target: string, staleVersionIdentity: Stats): boolean {
  const payload = { found: false };
  return hasResolvablePluginSymlinks(target, staleVersionIdentity, [], payload) && payload.found;
}

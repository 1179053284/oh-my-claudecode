/* global process, URL */

import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  futimesSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJevEnv } from "../jev-resolve.mjs";

const SWEEP_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get the cross-process sweep throttle marker path.
 * Keep the marker below the user's private state directory, not shared tmp.
 */
function getSweepThrottleMarkerPath() {
  const home = homedir();
  const omcDir = join(home, ".omc");
  const stateDir = join(omcDir, "state");
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    for (const directory of [home, omcDir, stateDir]) {
      const stats = lstatSync(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) return undefined;
      if (
        typeof process.getuid === "function" &&
        (stats.uid !== process.getuid() || (stats.mode & 0o022) !== 0)
      ) {
        return undefined;
      }
    }
    return join(stateDir, ".jev-sweep-throttle");
  } catch {
    return undefined;
  }
}

function isOwnedMarkerFile(stats) {
  return (
    stats.isFile() &&
    (typeof process.getuid !== "function" || stats.uid === process.getuid())
  );
}

/**
 * Check if sweep should run based on throttle marker mtime.
 */
function shouldRunSweep(markerPath) {
  if (!markerPath) return false;
  try {
    const stats = lstatSync(markerPath);
    return (
      isOwnedMarkerFile(stats) &&
      Date.now() - stats.mtimeMs >= SWEEP_THROTTLE_MS
    );
  } catch (error) {
    // Only a missing marker permits an initial sweep; inaccessible markers fail closed.
    return error?.code === "ENOENT";
  }
}

/**
 * Update sweep throttle marker mtime to now.
 */
function updateSweepMarker(markerPath) {
  if (!markerPath) return false;

  const noFollow = constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = openSync(markerPath, constants.O_WRONLY | noFollow);
  } catch (error) {
    if (error?.code !== "ENOENT") return false;
  }

  if (descriptor === undefined) {
    try {
      descriptor = openSync(
        markerPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600,
      );
    } catch {
      return false;
    }
  }

  try {
    if (!isOwnedMarkerFile(fstatSync(descriptor))) return false;
    const now = new Date();
    futimesSync(descriptor, now, now);
    return true;
  } catch {
    return false;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Get the Jev mode for a point: 'off' | 'shadow' | 'active'.
 * Reuses the script resolver's config gates and union activation semantics.
 */
export function jevModeFor(point, env = process.env) {
  return parseJevEnv(point, env);
}

/**
 * Check if Jev is opted in for a point (shadow or active, not off).
 * Backward-compatible boolean API for existing callers.
 */
export function isJevShadowOptedIn(point, env = process.env) {
  return jevModeFor(point, env) !== "off";
}

/**
 * Sweep and remove stale /tmp/omc-jev-* directories older than the given threshold.
 * Used for cleaning up leaked temp dirs from previous sessions.
 * Returns the count of successfully removed directories.
 */
export function sweepStaleTempDirs(maxAgeMs = 24 * 60 * 60 * 1000) {
  const tmpDir = tmpdir();
  const now = Date.now();
  let cleaned = 0;

  try {
    const entries = readdirSync(tmpDir);
    for (const entry of entries) {
      if (!entry.startsWith("omc-jev-")) continue;

      const fullPath = join(tmpDir, entry);
      try {
        const stats = lstatSync(fullPath);
        if (stats.isDirectory() && now - stats.mtimeMs > maxAgeMs) {
          rmSync(fullPath, { recursive: true, force: true });
          cleaned++;
        }
      } catch {
        // Skip entries that can't be stat'd or removed
      }
    }
  } catch {
    // If we can't read the tmp directory, skip the sweep
  }

  return cleaned;
}

/**
 * Fire-and-record one script-side judgment.
 * - Shadow mode: fire-and-forget, returns undefined immediately
 * - Active mode: waits (sync) for Jev answer, returns { mode, answer, source, ... }
 * - Off mode: returns undefined
 * Falls back to undefined (caller uses heuristic) on timeout/error/parse-failure.
 */
export function recordJevShadow({ point, state, questions, heuristic }) {
  const mode = jevModeFor(point);
  if (mode === "off") return undefined;

  // Throttled best-effort sweep of stale temp directories (once per hour)
  // This cleans up leftovers from killed resolvers that couldn't clean themselves
  const markerPath = getSweepThrottleMarkerPath();
  try {
    if (shouldRunSweep(markerPath) && updateSweepMarker(markerPath)) {
      sweepStaleTempDirs(24 * 60 * 60 * 1000); // Clean dirs older than 24h
    }
  } catch {
    // Best effort: marker or sweep failures never affect judgment recording
  }

  let tempDir;
  let requestFile;
  try {
    tempDir = mkdtempSync(join(tmpdir(), "omc-jev-"));
    requestFile = join(tempDir, "request.json");

    writeFileSync(
      requestFile,
      JSON.stringify({ point, state, questions, heuristic }),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );

    if (mode === "shadow") {
      // Fire-and-forget for shadow mode
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("../jev-resolve.mjs", import.meta.url)),
          "--request-file",
          requestFile,
        ],
        {
          stdio: ["ignore", "ignore", "ignore"],
          env: process.env,
        },
      );
      child.on("error", () => {
        // Clean up temp dir on spawn error
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Best effort
        }
      });
      child.unref();
      return undefined;
    }

    // Active mode: spawn synchronously and read result
    if (mode === "active") {
      try {
        const result = spawnSync(
          process.execPath,
          [
            fileURLToPath(new URL("../jev-resolve.mjs", import.meta.url)),
            "--request-file",
            requestFile,
          ],
          {
            stdio: ["ignore", "pipe", "ignore"],
            env: process.env,
            encoding: "utf8",
            timeout:
              (parseInt(process.env.OMC_JEV_TIMEOUT_MS || "2000", 10) || 2000) +
              500, // Add buffer
          },
        );

        if (result.status === 0 && result.stdout) {
          try {
            return JSON.parse(result.stdout);
          } catch {
            // Parse error: fall back to heuristic
            return undefined;
          }
        }
      } finally {
        // Always clean up temp dir after active mode
        if (tempDir) {
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {
            // Best effort
          }
        }
      }
    }
  } catch {
    // Jev logging is advisory; temp-file or spawn failures never affect hooks.
    // Clean up temp dir on any exception
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
  }
  return undefined;
}

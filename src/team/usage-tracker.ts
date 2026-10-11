// src/team/usage-tracker.ts

/**
 * Usage tracker for team sessions.
 *
 * Tracks wall-clock time and prompt/response character counts per task.
 * NOTE: Token counts are not available from Codex/Gemini CLI output.
 * Character counts serve as a rough proxy for usage estimation.
 *
 * Storage: append-only JSONL at .omc/logs/team-usage-{team}.jsonl
 */

import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { join } from 'node:path';
import { getOmcRoot } from '../lib/worktree-paths.js';
import { appendFileWithMode, ensureDirWithMode, validateResolvedPath } from './fs-utils.js';

export interface TaskUsageRecord {
  taskId: string;
  workerName: string;
  provider: 'codex' | 'gemini';
  model: string;
  startedAt: string;
  completedAt: string;
  wallClockMs: number;
  promptChars: number;
  responseChars: number;
}

export interface WorkerUsageSummary {
  workerName: string;
  provider: 'codex' | 'gemini';
  model: string;
  taskCount: number;
  totalWallClockMs: number;
  totalPromptChars: number;
  totalResponseChars: number;
}

export interface TeamUsageReport {
  teamName: string;
  totalWallClockMs: number;
  taskCount: number;
  workers: WorkerUsageSummary[];
}

function getUsageLogPath(workingDirectory: string, teamName: string): string {
  return join(getOmcRoot(workingDirectory), 'logs', `team-usage-${teamName}.jsonl`);
}

/**
 * Record usage for a completed task.
 */
export function recordTaskUsage(
  workingDirectory: string,
  teamName: string,
  record: TaskUsageRecord
): void {
  const logPath = getUsageLogPath(workingDirectory, teamName);
  const dir = join(getOmcRoot(workingDirectory), 'logs');
  // logPath lives under getOmcRoot(...)/logs, which in a .omc-workspace layout
  // is ABOVE workingDirectory. Validate against the shared logs dir (still
  // catches teamName traversal) instead of the sub-repo.
  validateResolvedPath(logPath, dir);
  ensureDirWithMode(dir);
  appendFileWithMode(logPath, JSON.stringify(record) + '\n');
}

/** Count UTF-8 Unicode code points with bounded memory, preserving split characters. */
function countFileCharacters(filePath: string): number {
  const descriptor = openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const decoder = new StringDecoder('utf8');
    let count = 0;
    let bytesRead: number;
    while ((bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      for (const _character of decoder.write(buffer.subarray(0, bytesRead))) count++;
    }
    for (const _character of decoder.end()) count++;
    return count;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Compute Unicode code point counts from UTF-8 prompt and output files.
 * Combining marks count separately; these are not grapheme or token counts.
 * Returns { promptChars, responseChars }. Returns 0 for missing/unreadable files.
 */
export function measureCharCounts(
  promptFilePath: string,
  outputFilePath: string
): { promptChars: number; responseChars: number } {
  let promptChars = 0;
  let responseChars = 0;

  try {
    promptChars = countFileCharacters(promptFilePath);
  } catch { /* missing or unreadable file */ }

  try {
    responseChars = countFileCharacters(outputFilePath);
  } catch { /* missing or unreadable file */ }

  return { promptChars, responseChars };
}

/**
 * Read all usage records from the JSONL log.
 */
function readUsageRecords(workingDirectory: string, teamName: string): TaskUsageRecord[] {
  const logPath = getUsageLogPath(workingDirectory, teamName);
  if (!existsSync(logPath)) return [];

  const content = readFileSync(logPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  const records: TaskUsageRecord[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch { /* skip malformed */ }
  }

  return records;
}

/**
 * Generate usage report for a team session.
 * Aggregates TaskUsageRecords from the JSONL log.
 */
export function generateUsageReport(
  workingDirectory: string,
  teamName: string
): TeamUsageReport {
  const records = readUsageRecords(workingDirectory, teamName);

  // Aggregate per worker
  const workerMap = new Map<string, WorkerUsageSummary>();

  for (const r of records) {
    const existing = workerMap.get(r.workerName);
    if (existing) {
      existing.taskCount++;
      existing.totalWallClockMs += r.wallClockMs;
      existing.totalPromptChars += r.promptChars;
      existing.totalResponseChars += r.responseChars;
    } else {
      workerMap.set(r.workerName, {
        workerName: r.workerName,
        provider: r.provider,
        model: r.model,
        taskCount: 1,
        totalWallClockMs: r.wallClockMs,
        totalPromptChars: r.promptChars,
        totalResponseChars: r.responseChars,
      });
    }
  }

  const workers = Array.from(workerMap.values());

  return {
    teamName,
    totalWallClockMs: workers.reduce((sum, w) => sum + w.totalWallClockMs, 0),
    taskCount: workers.reduce((sum, w) => sum + w.taskCount, 0),
    workers,
  };
}

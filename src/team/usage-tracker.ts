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

import { z } from 'zod';
import { existsSync, readFileSync, statSync } from 'node:fs';
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

/**
 * Compute character counts from prompt and output files.
 * Returns { promptChars, responseChars }. Returns 0 for missing files.
 */
export function measureCharCounts(
  promptFilePath: string,
  outputFilePath: string
): { promptChars: number; responseChars: number } {
  let promptChars = 0;
  let responseChars = 0;

  try {
    if (existsSync(promptFilePath)) {
      promptChars = statSync(promptFilePath).size;
    }
  } catch { /* missing file */ }

  try {
    if (existsSync(outputFilePath)) {
      responseChars = statSync(outputFilePath).size;
    }
  } catch { /* missing file */ }

  return { promptChars, responseChars };
}

const nonemptyString = z.string().refine(value => value.trim().length > 0);
const taskUsageRecordSchema: z.ZodType<TaskUsageRecord> = z.object({
  taskId: nonemptyString,
  workerName: nonemptyString,
  provider: z.enum(['codex', 'gemini']),
  model: z.string(),
  startedAt: nonemptyString,
  completedAt: nonemptyString,
  wallClockMs: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
  promptChars: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  responseChars: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/** Base-10 representation used to sum JSON duration values without intermediate binary rounding. */
interface ExactDecimal {
  coefficient: bigint;
  scale: number;
}

const ZERO_DURATION: ExactDecimal = { coefficient: 0n, scale: 0 };
const MAX_SAFE_DURATION: ExactDecimal = { coefficient: BigInt(Number.MAX_SAFE_INTEGER), scale: 0 };
// Public report fields are Numbers; reject projections that distort either addend by more than 1e-12.
const DURATION_RELATIVE_TOLERANCE: ExactDecimal = { coefficient: 1n, scale: 12 };

function exactDecimalFromNumber(value: number): ExactDecimal {
  const [mantissa, exponentText] = value.toString().toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  let coefficient = BigInt(`${whole}${fraction}`);
  let scale = fraction.length - Number(exponentText ?? 0);
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}

function alignExactDecimals(left: ExactDecimal, right: ExactDecimal): [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * 10n ** BigInt(scale - left.scale),
    right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  ];
}

function addExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const [leftCoefficient, rightCoefficient, scale] = alignExactDecimals(left, right);
  return { coefficient: leftCoefficient + rightCoefficient, scale };
}

function subtractExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const [leftCoefficient, rightCoefficient, scale] = alignExactDecimals(left, right);
  return { coefficient: leftCoefficient - rightCoefficient, scale };
}

function absoluteExactDecimal(value: ExactDecimal): ExactDecimal {
  return { coefficient: value.coefficient < 0n ? -value.coefficient : value.coefficient, scale: value.scale };
}

function multiplyExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  return { coefficient: left.coefficient * right.coefficient, scale: left.scale + right.scale };
}

function compareExactDecimals(left: ExactDecimal, right: ExactDecimal): number {
  const [leftCoefficient, rightCoefficient] = alignExactDecimals(left, right);
  return leftCoefficient < rightCoefficient ? -1 : leftCoefficient > rightCoefficient ? 1 : 0;
}

function exactDecimalToNumber(value: ExactDecimal): number {
  const isNegative = value.coefficient < 0n;
  const digits = (isNegative ? -value.coefficient : value.coefficient).toString();
  const integerLength = digits.length - value.scale;
  const magnitude = value.scale === 0
    ? digits
    : integerLength > 0
      ? `${digits.slice(0, integerLength)}.${digits.slice(integerLength)}`
      : `0.${'0'.repeat(-integerLength)}${digits}`;
  return Number(isNegative ? `-${magnitude}` : magnitude);
}

function exceedsDurationRoundingTolerance(actual: ExactDecimal, expected: ExactDecimal): boolean {
  const difference = absoluteExactDecimal(subtractExactDecimals(actual, expected));
  const tolerance = multiplyExactDecimals(absoluteExactDecimal(expected), DURATION_RELATIVE_TOLERANCE);
  return compareExactDecimals(difference, tolerance) > 0;
}

function durationAdditionLosesPrecision(
  previousTotal: ExactDecimal,
  duration: ExactDecimal,
  nextTotal: ExactDecimal,
  roundedNextTotal: number,
): boolean {
  const reportedTotal = exactDecimalFromNumber(roundedNextTotal);
  const reportedDuration = subtractExactDecimals(reportedTotal, previousTotal);
  const recoveredPreviousTotal = subtractExactDecimals(reportedTotal, duration);
  return exceedsDurationRoundingTolerance(reportedDuration, duration)
    || exceedsDurationRoundingTolerance(recoveredPreviousTotal, previousTotal);
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
      const record = taskUsageRecordSchema.safeParse(JSON.parse(line));
      if (record.success) records.push(record.data);
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
  const workerDurationTotals = new Map<string, ExactDecimal>();
  let totalWallClockMsExact = ZERO_DURATION;
  let totalWallClockMs = 0;

  for (const r of records) {
    const existing = workerMap.get(r.workerName);
    const currentWallClockMsExact = workerDurationTotals.get(r.workerName) ?? ZERO_DURATION;
    const durationExact = exactDecimalFromNumber(r.wallClockMs);
    const nextWallClockMsExact = addExactDecimals(currentWallClockMsExact, durationExact);
    const nextPromptChars = (existing?.totalPromptChars ?? 0) + r.promptChars;
    const nextResponseChars = (existing?.totalResponseChars ?? 0) + r.responseChars;
    const nextTotalWallClockMsExact = addExactDecimals(totalWallClockMsExact, durationExact);
    if (compareExactDecimals(nextWallClockMsExact, MAX_SAFE_DURATION) > 0
      || compareExactDecimals(nextTotalWallClockMsExact, MAX_SAFE_DURATION) > 0) continue;
    const nextWallClockMs = exactDecimalToNumber(nextWallClockMsExact);
    const nextTotalWallClockMs = exactDecimalToNumber(nextTotalWallClockMsExact);
    const losesDurationPrecision = durationAdditionLosesPrecision(
      currentWallClockMsExact, durationExact, nextWallClockMsExact, nextWallClockMs,
    ) || durationAdditionLosesPrecision(
      totalWallClockMsExact, durationExact, nextTotalWallClockMsExact, nextTotalWallClockMs,
    );
    // Skip the whole record if adding it would corrupt totals; retain later valid siblings.
    if (!Number.isFinite(nextWallClockMs) || !Number.isFinite(nextTotalWallClockMs)
      || losesDurationPrecision
      || !Number.isSafeInteger(nextPromptChars) || !Number.isSafeInteger(nextResponseChars)) continue;
    workerDurationTotals.set(r.workerName, nextWallClockMsExact);
    totalWallClockMsExact = nextTotalWallClockMsExact;
    totalWallClockMs = nextTotalWallClockMs;
    if (existing) {
      existing.taskCount++;
      existing.totalWallClockMs = nextWallClockMs;
      existing.totalPromptChars = nextPromptChars;
      existing.totalResponseChars = nextResponseChars;
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
    totalWallClockMs,
    taskCount: workers.reduce((sum, w) => sum + w.taskCount, 0),
    workers,
  };
}

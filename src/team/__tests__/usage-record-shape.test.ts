import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOmcRoot } from '../../lib/worktree-paths.js';
import { generateUsageReport, recordTaskUsage, type TaskUsageRecord } from '../usage-tracker.js';

describe('usage JSONL record recovery', () => {
  let root: string;
  let previous: string | undefined;
  const valid: TaskUsageRecord = {
    taskId: 'task-1', workerName: 'worker-1', provider: 'codex', model: 'model-1',
    startedAt: '2026-10-10T00:00:00Z', completedAt: '2026-10-10T00:00:01Z',
    wallClockMs: 1000.5, promptChars: 3, responseChars: 7,
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'omc-usage-shape-'));
    previous = process.env.OMC_STATE_DIR;
    process.env.OMC_STATE_DIR = join(root, 'private-state');
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.OMC_STATE_DIR;
    else process.env.OMC_STATE_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });
  it('skips malformed shapes and counts while retaining valid surrounding records', () => {
    recordTaskUsage(root, 'shape', valid);
    const log = join(getOmcRoot(root), 'logs', 'team-usage-shape.jsonl');
    const malformed: unknown[] = [null, [], 12, 'text', {}, { ...valid, provider: 'other' }];
    for (const field of Object.keys(valid)) {
      const missing = { ...valid } as Record<string, unknown>;
      delete missing[field];
      malformed.push(missing);
    }
    for (const field of ['taskId', 'workerName', 'model', 'startedAt', 'completedAt']) {
      malformed.push({ ...valid, [field]: 42 });
    }
    for (const field of ['wallClockMs', 'promptChars', 'responseChars']) {
      for (const value of [null, '5', -1]) malformed.push({ ...valid, [field]: value });
    }
    malformed.push({ ...valid, promptChars: 0.5 }, { ...valid, responseChars: 0.5 });
    appendFileSync(log, malformed.map(value => JSON.stringify(value)).join('\n') + '\n');
    appendFileSync(log, JSON.stringify(valid).replace('1000.5', '1e999') + '\n{broken\n');
    recordTaskUsage(root, 'shape', { ...valid, taskId: 'task-2' });
    const bytes = readFileSync(log);
    expect(generateUsageReport(root, 'shape')).toEqual({
      teamName: 'shape', taskCount: 2, totalWallClockMs: 2001,
      workers: [{ workerName: 'worker-1', provider: 'codex', model: 'model-1', taskCount: 2,
        totalWallClockMs: 2001, totalPromptChars: 6, totalResponseChars: 14 }],
    });
    expect(readFileSync(log)).toEqual(bytes);
  });
  it('retains records with an empty model for provider defaults', () => {
    recordTaskUsage(root, 'default-model', { ...valid, model: '' });

    const report = generateUsageReport(root, 'default-model');
    expect(report.taskCount).toBe(1);
    expect(report.workers[0].model).toBe('');
  });
  it('retains ordinary fractional durations when floating-point sums round normally', () => {
    recordTaskUsage(root, 'fractional', { ...valid, wallClockMs: 0.1 });
    recordTaskUsage(root, 'fractional', { ...valid, taskId: 'task-2', wallClockMs: 0.2 });

    const report = generateUsageReport(root, 'fractional');
    expect(report.taskCount).toBe(2);
    expect(report.totalWallClockMs).toBe(0.1 + 0.2);
    expect(report.workers[0].totalWallClockMs).toBe(0.1 + 0.2);
  });
  it('skips finite but unsafe counters and overflow-prone durations without poisoning valid siblings', () => {
    recordTaskUsage(root, 'large', valid);
    const log = join(getOmcRoot(root), 'logs', 'team-usage-large.jsonl');
    for (const field of ['wallClockMs', 'promptChars', 'responseChars']) {
      const record = { ...valid, [field]: 1e308 };
      appendFileSync(log, JSON.stringify(record) + '\n' + JSON.stringify(record) + '\n');
    }
    recordTaskUsage(root, 'large', { ...valid, taskId: 'task-2' });
    const bytes = readFileSync(log);
    const report = generateUsageReport(root, 'large');
    expect(report.taskCount).toBe(2);
    expect(report.totalWallClockMs).toBe(2001);
    expect(report.workers[0].totalPromptChars).toBe(6);
    expect(report.workers[0].totalResponseChars).toBe(14);
    expect(readFileSync(log)).toEqual(bytes);
  });
  it('skips an addition that would lose safe counter precision while retaining later valid workers', () => {
    recordTaskUsage(root, 'sum', { ...valid, promptChars: Number.MAX_SAFE_INTEGER, responseChars: 0 });
    recordTaskUsage(root, 'sum', { ...valid, promptChars: 1, responseChars: 0 });
    recordTaskUsage(root, 'sum', { ...valid, workerName: 'worker-2' });
    const report = generateUsageReport(root, 'sum');
    expect(report.taskCount).toBe(2);
    expect(report.workers[0].totalPromptChars).toBe(Number.MAX_SAFE_INTEGER);
    expect(report.workers[1].totalPromptChars).toBe(3);
    expect(report.totalWallClockMs).toBe(2001);
  });
  it('skips duration additions beyond the safe aggregate range while retaining later records', () => {
    recordTaskUsage(root, 'duration', {
      ...valid, workerName: 'worker-1', wallClockMs: Number.MAX_SAFE_INTEGER, promptChars: 0, responseChars: 0,
    });
    for (let task = 0; task < 10; task++) {
      recordTaskUsage(root, 'duration', { ...valid, taskId: `rounded-${task}`, workerName: 'worker-2', wallClockMs: 1 });
    }
    recordTaskUsage(root, 'duration', {
      ...valid, taskId: 'later', workerName: 'worker-3', wallClockMs: 0, promptChars: 2, responseChars: 3,
    });

    const report = generateUsageReport(root, 'duration');
    expect(report.taskCount).toBe(2);
    expect(report.totalWallClockMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(report.workers.map(worker => worker.workerName)).toEqual(['worker-1', 'worker-3']);
    expect(report.workers[1].totalPromptChars).toBe(2);
  });
  it('skips a positive duration increment when floating-point precision changes it', () => {
    recordTaskUsage(root, 'rounded', {
      ...valid, workerName: 'worker-1', wallClockMs: Number.MAX_SAFE_INTEGER - 1, promptChars: 0, responseChars: 0,
    });
    recordTaskUsage(root, 'rounded', { ...valid, taskId: 'overstated', wallClockMs: 0.75 });
    recordTaskUsage(root, 'rounded', { ...valid, taskId: 'later', workerName: 'worker-3', wallClockMs: 1 });

    const report = generateUsageReport(root, 'rounded');
    expect(report.taskCount).toBe(2);
    expect(report.totalWallClockMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(report.workers.map(worker => worker.workerName)).toEqual(['worker-1', 'worker-3']);
    expect(report.workers[0].totalWallClockMs).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(report.workers[1].totalWallClockMs).toBe(1);
  });
  it('skips duration additions that round away the existing subtotal', () => {
    recordTaskUsage(root, 'prior-total', {
      ...valid, workerName: 'worker-1', wallClockMs: 0.25, promptChars: 0, responseChars: 0,
    });
    recordTaskUsage(root, 'prior-total', {
      ...valid, taskId: 'lost-prior-total', workerName: 'worker-1',
      wallClockMs: Number.MAX_SAFE_INTEGER - 1, promptChars: 0, responseChars: 0,
    });
    recordTaskUsage(root, 'prior-total', {
      ...valid, taskId: 'later', workerName: 'worker-3', wallClockMs: 1, promptChars: 2, responseChars: 3,
    });

    const report = generateUsageReport(root, 'prior-total');
    expect(report.taskCount).toBe(2);
    expect(report.totalWallClockMs).toBe(1.25);
    expect(report.workers.map(worker => worker.workerName)).toEqual(['worker-1', 'worker-3']);
    expect(report.workers[0].totalWallClockMs).toBe(0.25);
    expect(report.workers[1].totalWallClockMs).toBe(1);
  });
  it('returns an empty report when every syntactically valid record is invalid', () => {
    recordTaskUsage(root, 'empty', valid);
    const log = join(getOmcRoot(root), 'logs', 'team-usage-empty.jsonl');
    writeFileSync(log, 'null\n{}\n[]\n');
    expect(generateUsageReport(root, 'empty')).toEqual({
      teamName: 'empty', taskCount: 0, totalWallClockMs: 0, workers: [],
    });
  });
});

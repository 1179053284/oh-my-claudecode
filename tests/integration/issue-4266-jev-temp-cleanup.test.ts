/** Temp directory cleanup for jev-shadow and jev-resolve (issue #4266). */
import { describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const JEVRESOLVE_PATH = join(PROJECT_ROOT, "scripts/jev-resolve.mjs");
const JEV_SHADOW_URL = pathToFileURL(
  join(PROJECT_ROOT, "scripts/lib/jev-shadow.mjs"),
).href;

function runResolver(requestFile: string) {
  return spawnSync(
    process.execPath,
    [JEVRESOLVE_PATH, "--request-file", requestFile],
    {
      env: { ...process.env, OMC_JEV: "off" },
      encoding: "utf8",
    },
  );
}

function runActiveRecord(tempRoot: string, homeRoot: string) {
  const script = `
    import { recordJevShadow } from ${JSON.stringify(JEV_SHADOW_URL)};
    const result = recordJevShadow({
      point: "cleanup-test",
      state: {},
      questions: {},
      heuristic: "test",
    });
    console.log(JSON.stringify({ result }));
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      HOME: homeRoot,
      USERPROFILE: homeRoot,
      TMPDIR: tempRoot,
      TMP: tempRoot,
      TEMP: tempRoot,
      OMC_JEV: "cleanup-test:active",
      TYPESAFE_API_KEY: "test-key",
      OMC_JEV_ENDPOINT: "http://127.0.0.1:1",
      OMC_JEV_TIMEOUT_MS: "100",
      OMC_JEV_LOG_DIR: join(homeRoot, "logs"),
    },
    encoding: "utf8",
    timeout: 5000,
  });
}

describe("issue #4266: Jev temp directory cleanup", () => {
  it("removes the generated temp directory after reading a request", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "omc-jev-"));
    try {
      const requestFile = join(tempDir, "request.json");
      writeFileSync(
        requestFile,
        JSON.stringify({ point: "test", state: {}, questions: {} }),
      );

      const result = runResolver(requestFile);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ mode: "off" });
      expect(existsSync(tempDir)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("removes its temp directory after a request read or parse failure", () => {
    for (const contents of [undefined, "invalid json"]) {
      const tempDir = mkdtempSync(join(tmpdir(), "omc-jev-"));
      try {
        const requestFile = join(tempDir, "request.json");
        if (contents !== undefined) writeFileSync(requestFile, contents);

        const result = runResolver(requestFile);

        expect(result.status).toBe(0);
        expect(existsSync(tempDir)).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it("only removes the request file outside the temp root", () => {
    const parent = mkdtempSync(join(tmpdir(), "issue-4266-parent-"));
    const nested = join(parent, "omc-jev-cache");
    mkdirSync(nested);
    const requestFile = join(nested, "request.json");
    const siblingFile = join(nested, "unrelated.txt");
    writeFileSync(
      requestFile,
      JSON.stringify({ point: "test", state: {}, questions: {} }),
    );
    writeFileSync(siblingFile, "keep");

    try {
      const result = runResolver(requestFile);

      expect(result.status).toBe(0);
      expect(existsSync(nested)).toBe(true);
      expect(existsSync(requestFile)).toBe(false);
      expect(existsSync(siblingFile)).toBe(true);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("sweeps stale dirs on an enabled active record without using shared tmp for its marker", () => {
    const testRoot = mkdtempSync(join(tmpdir(), "issue-4266-"));
    const tempRoot = join(testRoot, "tmp");
    const homeRoot = join(testRoot, "home");
    mkdirSync(tempRoot, { mode: 0o700 });
    mkdirSync(homeRoot, { mode: 0o700 });
    const staleDir = mkdtempSync(join(tempRoot, "omc-jev-"));
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(staleDir, oldTime, oldTime);

    const sharedTmpMarker = join(tempRoot, ".omc-jev-sweep-throttle");
    const victimPath = join(homeRoot, "victim");
    let createdSymlink = false;
    if (process.platform !== "win32") {
      symlinkSync(victimPath, sharedTmpMarker);
      createdSymlink = true;
    }

    try {
      const result = runActiveRecord(tempRoot, homeRoot);
      const privateMarker = join(
        homeRoot,
        ".omc",
        "state",
        ".jev-sweep-throttle",
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).result.mode).toBe("degraded");
      expect(existsSync(staleDir)).toBe(false);
      expect(existsSync(privateMarker)).toBe(true);
      expect(existsSync(victimPath)).toBe(false);
      expect(
        readdirSync(tempRoot).filter((entry) => entry.startsWith("omc-jev-")),
      ).toEqual([]);
      if (createdSymlink)
        expect(lstatSync(sharedTmpMarker).isSymbolicLink()).toBe(true);
    } finally {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("skips the sweep when the private state directory cannot host a throttle marker", () => {
    const testRoot = mkdtempSync(join(tmpdir(), "issue-4266-no-marker-"));
    const tempRoot = join(testRoot, "tmp");
    const homeRoot = join(testRoot, "home");
    mkdirSync(tempRoot, { mode: 0o700 });
    mkdirSync(homeRoot, { mode: 0o700 });
    chmodSync(homeRoot, 0o777);
    const staleDir = mkdtempSync(join(tempRoot, "omc-jev-"));
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(staleDir, oldTime, oldTime);

    try {
      const result = runActiveRecord(tempRoot, homeRoot);
      const privateMarker = join(
        homeRoot,
        ".omc",
        "state",
        ".jev-sweep-throttle",
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).result.mode).toBe("degraded");
      expect(existsSync(staleDir)).toBe(true);
      expect(existsSync(privateMarker)).toBe(false);
    } finally {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });
});

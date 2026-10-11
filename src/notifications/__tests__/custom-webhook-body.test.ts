import { afterEach, describe, expect, it, vi } from "vitest";
import { sendCustomWebhook } from "../dispatcher.js";
import type { CustomIntegration, NotificationPayload } from "../types.js";

const payload: NotificationPayload = {
  event: "session-end", sessionId: "test-session", message: "finished",
  timestamp: "2026-10-10T00:00:00Z",
  projectName: 'A "quoted" project\nC:\\workspace',
  contextSummary: 'line one\n"quoted" \\ line two  ',
  agentsSpawned: 3,
};

function webhook(bodyTemplate: string, headers: Record<string, string>): CustomIntegration {
  return {
    id: "test-webhook", type: "webhook", enabled: true, events: ["session-end"],
    config: { url: "https://example.invalid/hooks", method: "POST", headers, bodyTemplate, timeout: 1000 },
  };
}

afterEach(() => vi.unstubAllGlobals());

const jsonHeaders: Record<string, string>[] = [
  { "Content-Type": "application/json" },
  { "content-type": "application/problem+json; charset=utf-8" },
  { "cOnTeNt-TyPe": "APPLICATION/VND.HOOKS+JSON; CHARSET=UTF-8" },
];

describe("custom webhook body interpolation", () => {
  it.each(jsonHeaders)("serializes JSON string placeholders safely for %j", async headers => {
    let body: unknown;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      body = JSON.parse(String(options.body));
      return new Response(null, { status: 204 });
    }));
    const result = await sendCustomWebhook(webhook(JSON.stringify({
      project: "{{projectName}}", nested: [{ summary: "{{contextSummary}}" }], count: 7,
    }), headers), payload);
    expect(result.success).toBe(true);
    expect(body).toEqual({ project: payload.projectName, nested: [{ summary: payload.contextSummary }], count: 7 });
  });

  it("preserves plain text body interpolation", async () => {
    let body: unknown;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      body = options.body;
      return new Response(null, { status: 204 });
    }));
    expect((await sendCustomWebhook(webhook("project={{projectName}}", { "Content-Type": "text/plain" }), payload)).success).toBe(true);
    expect(body).toBe(`project=${payload.projectName}`);
  });

  it("preserves raw numeric placeholder templates", async () => {
    let body: unknown;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      body = JSON.parse(String(options.body));
      return new Response(null, { status: 204 });
    }));
    expect((await sendCustomWebhook(webhook('{"count":{{agentsSpawned}}}', { "Content-Type": "application/json" }), payload)).success).toBe(true);
    expect(body).toEqual({ count: 3 });
  });
});

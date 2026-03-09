import { describe, test, expect, afterEach } from "bun:test";
import { join } from "path";

const SCRIPT_PATH = join(import.meta.dir, "webhook-notify.ts");

describe("webhook-notify", () => {
  let mockServer: ReturnType<typeof Bun.serve> | null = null;

  afterEach(() => {
    if (mockServer) {
      mockServer.stop(true);
      mockServer = null;
    }
  });

  test("exits with code 1 and prints usage to stderr when < 4 args", async () => {
    const proc = Bun.spawn(["bun", SCRIPT_PATH, "BRE-202", "clarify"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });

  test("exits with code 1 with zero args", async () => {
    const proc = Bun.spawn(["bun", SCRIPT_PATH], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });

  test("sends POST with correct JSON body and prints success line", async () => {
    let receivedBody: unknown = null;
    let receivedAuth = "";

    mockServer = Bun.serve({
      port: 0, // random available port
      fetch(req) {
        receivedAuth = req.headers.get("authorization") || "";
        return req.json().then((body) => {
          receivedBody = body;
          return new Response("ok");
        });
      },
    });

    const port = mockServer.port;
    const proc = Bun.spawn(
      ["bun", SCRIPT_PATH, "BRE-202", "clarify", "plan", "running"],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          HOOKS_URL: `http://127.0.0.1:${port}/hooks/collab`,
        },
      }
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(receivedBody).toEqual({
      ticket: "BRE-202",
      from: "clarify",
      to: "plan",
      status: "running",
    });
    expect(receivedAuth).toContain("Bearer ");
    expect(stdout).toContain("Webhook sent for BRE-202: clarify \u2192 plan (running)");
  });
});

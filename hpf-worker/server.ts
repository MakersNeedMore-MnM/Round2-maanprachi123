/**
 * ΔHPF HTTP service — lets the Convex action request a real dual-run.
 *
 *   POST /measure   body: { url, budgetMs?, cpu?, network?, settleMs? }
 *                   → HpfMeasurement JSON (see src/lib/obsolescence/types.ts)
 *   GET  /health    → { ok: true }
 *
 * Run where Chromium is installed:
 *   npx playwright install chromium
 *   npx tsx hpf-worker/server.ts          # listens on HPF_PORT, default 8787
 *
 * Then set HPF_WORKER_URL (e.g. http://localhost:8787) in the project's
 * Keys/API-keys tab so new audits include the measured ΔHPF automatically.
 * The endpoint must be reachable from the Convex runtime (host it publicly,
 * or run the app against a local Convex backend for fully local audits).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { measureHpfDualRun } from "./measure";

const PORT = Number(process.env.HPF_PORT ?? 8787);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: string) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error("request body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

export function createHpfServer(): Server {
  return createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");

  if (req.method === "GET" && req.url?.startsWith("/health")) {
    send(res, 200, { ok: true, service: "hpf-worker" });
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/measure")) {
    void readBody(req)
      .then(async (raw) => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(raw || "{}") as Record<string, unknown>;
        } catch {
          send(res, 400, { error: "invalid JSON body" });
          return;
        }
        const url = typeof body.url === "string" ? body.url : "";
        if (!/^https?:\/\//i.test(url)) {
          send(res, 400, {
            error:
              'body must be {"url": "https://…", "budgetMs"?, "cpu"?, "network"?, "settleMs"?}',
          });
          return;
        }
        try {
          const result = await measureHpfDualRun({
            url,
            cpuThrottleRate: typeof body.cpu === "number" ? body.cpu : undefined,
            networkProfile: typeof body.network === "string" ? body.network : undefined,
            settleMs: typeof body.settleMs === "number" ? body.settleMs : undefined,
            totalBudgetMs: typeof body.budgetMs === "number" ? body.budgetMs : undefined,
          });
          send(res, 200, result);
        } catch (err) {
          send(res, 500, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .catch((err: unknown) => {
        send(res, 500, { error: err instanceof Error ? err.message : String(err) });
      });
    return;
  }

  send(res, 404, { error: "use POST /measure or GET /health" });
  });
}

/** Start listening; exported so tests can bind an ephemeral port. */
export function startServer(port: number | string = PORT): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createHpfServer();
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}

// Run as a service when executed directly (`npx tsx hpf-worker/server.ts`).
const isDirectRun = process.argv[1]?.includes("server");
if (isDirectRun) {
  void startServer().then((server) => {
    const addr = server.address();
    const shown = typeof addr === "object" && addr ? addr.port : PORT;
    console.error(`hpf-worker listening on http://localhost:${shown} (POST /measure {url, budgetMs})`);
  });
}

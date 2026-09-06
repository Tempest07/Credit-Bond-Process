import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractIssuanceWithLocalOllama,
  LOCAL_ISSUANCE_MODEL,
  LOCAL_ISSUANCE_PROMPT_REVISION,
} from "./local-issuance-ollama.mjs";
import { recognizeProjectWithLocalVision, MAX_VISION_IMAGE_BYTES, PROJECT_VISION_MODEL } from "./local-project-vision.mjs";

const MAX_REQUEST_BYTES = 64000;

export function createLocalIssuanceGateway(options = {}) {
  const token = options.token || process.env.LOCAL_ISSUANCE_AI_TOKEN;
  if (typeof token !== "string" || !/^[\x21-\x7e]{32,512}$/.test(token)) {
    throw new Error("LOCAL_ISSUANCE_AI_TOKEN must be a 32-512 character header-safe secret.");
  }
  const extract = options.extract || extractIssuanceWithLocalOllama;
  const recognizeVision = options.recognizeVision || recognizeProjectWithLocalVision;
  const logger = options.logger || console;
  const timeoutMs = Number(options.timeoutMs || process.env.LOCAL_ISSUANCE_AI_TIMEOUT_MS || 120000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 180000) throw new Error("LOCAL_ISSUANCE_AI_TIMEOUT_MS must be 5000-180000.");
  let active = false;

  return createServer(async (request, response) => {
    const started = Date.now();
    setHeaders(response);
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (!authorized(request.headers.authorization, token)) return send(response, 401, { error: "Unauthorized." });
    if (request.method === "GET" && url.pathname === "/health") {
      return send(response, 200, { status: "ok", model: LOCAL_ISSUANCE_MODEL, promptRevision: LOCAL_ISSUANCE_PROMPT_REVISION, visionModel: PROJECT_VISION_MODEL, busy: active });
    }
    const isVision = url.pathname === "/v1/project-screenshot";
    if (request.method !== "POST" || (!isVision && url.pathname !== "/v1/issuance-recognition")) return send(response, 404, { error: "Not found." });
    const mimeType = request.headers["content-type"]?.split(";")[0].toLowerCase();
    if (isVision && !["image/png", "image/jpeg", "image/webp"].includes(mimeType)) return send(response, 415, { error: "Unsupported image format." });
    const limit = isVision ? MAX_VISION_IMAGE_BYTES : MAX_REQUEST_BYTES;
    if (Number(request.headers["content-length"]) > limit) return send(response, 413, { error: "Request is too large." });
    if (active) return send(response, 429, { error: "Local inference is busy." });

    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    const abort = () => { if (!response.writableEnded) controller.abort(); };
    response.once("close", abort);
    active = true;
    try {
      const body = await readBoundedBody(request, limit);
      const result = isVision
        ? await recognizeVision(body, mimeType, { signal: controller.signal })
        : await extract(JSON.parse(body.toString("utf8"))?.request, { timeoutMs, signal: controller.signal });
      logger.log(JSON.stringify({ event: isVision ? "local_vision_complete" : "local_issuance_complete", elapsedMs: Date.now() - started, attempts: result.attempts }));
      return send(response, 200, result);
    } catch (error) {
      const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      logger.warn(JSON.stringify({ event: isVision ? "local_vision_failed" : "local_issuance_failed", name: error?.name || "Error", elapsedMs: Date.now() - started }));
      if (!response.destroyed) return send(response, error?.status || (timeout ? 504 : 400), { error: timeout ? "Local inference timed out." : "Local inference failed." });
    } finally {
      active = false;
      response.removeListener("close", abort);
    }
  });
}

function authorized(header, expected) {
  const provided = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

async function readBoundedBody(request, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw Object.assign(new Error("Request is too large."), { status: 413 });
    chunks.push(chunk);
  }
  if (!length) throw new Error("Request body is empty.");
  return Buffer.concat(chunks);
}

function setHeaders(response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function send(response, status, body) {
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

function start() {
  const host = process.env.LOCAL_ISSUANCE_AI_HOST || "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("LOCAL_ISSUANCE_AI_HOST must remain loopback-only; use Cloudflare Tunnel to expose it.");
  const port = Number(process.env.LOCAL_ISSUANCE_AI_PORT || 11435);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("LOCAL_ISSUANCE_AI_PORT must be 1024-65535.");
  const server = createLocalIssuanceGateway();
  server.listen(port, host, () => console.log(JSON.stringify({ event: "local_issuance_gateway_ready", host, port, model: LOCAL_ISSUANCE_MODEL })));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) start();

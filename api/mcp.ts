import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MCP_ACCESS_KEY = process.env.TOKEN_BURN_MCP_ACCESS_KEY!;

const tb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).schema("token_burn");

const VALID_DRIVERS = new Set([
  "infrastructure", "career", "creative", "markets", "research", "personal",
]);
const MACHINE_SCHEMA = z.enum(["mini", "imac", "macbook"]);
const MACHINE_DESCRIPTION = "Structural machine label: mini | imac | macbook. Do not use agent nicknames such as cadence, coda, or lumen.";

function validateDriver(driver: string | undefined): string | null {
  if (driver === undefined || driver === "") return null;
  if (!VALID_DRIVERS.has(driver)) return `Invalid driver "${driver}". Must be one of: ${[...VALID_DRIVERS].join(", ")}`;
  return null;
}

function validateDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
}

const server = new McpServer({
  name: "token-burn",
  version: "1.0.0",
});

server.registerTool(
  "record_code_session",
  {
    title: "Record Code Session",
    description:
      "Record exact token usage for a Claude Code session. Call at session closeout. Upserts on (session_id, machine) — safe to call multiple times for the same session.",
    inputSchema: {
      session_id:     z.string().describe("JSONL filename stem (no path, no .jsonl extension)"),
      machine:        MACHINE_SCHEMA.describe(MACHINE_DESCRIPTION),
      session_date:   z.string().describe("Session date in YYYY-MM-DD format (Mountain time)"),
      input_tokens:   z.number().int().min(0).describe("Non-cached input tokens"),
      output_tokens:  z.number().int().min(0).describe("Output tokens"),
      cache_read:     z.number().int().min(0).describe("cache_read_input_tokens"),
      cache_create:   z.number().int().min(0).describe("cache_creation_input_tokens"),
      api_requests:   z.number().int().min(0).describe("Count of assistant turns"),
      driver:         z.string().optional().describe("Session driver: infrastructure | career | creative | markets | research | personal"),
      notes:          z.string().optional().describe("Freeform session summary (max 500 chars)"),
    },
  },
  async ({ session_id, machine, session_date, input_tokens, output_tokens, cache_read, cache_create, api_requests, driver, notes }) => {
    try {
      const driverErr = validateDriver(driver);
      if (driverErr) {
        return { content: [{ type: "text" as const, text: driverErr }], isError: true };
      }
      if (!validateDate(session_date)) {
        return { content: [{ type: "text" as const, text: `Invalid session_date "${session_date}". Use YYYY-MM-DD.` }], isError: true };
      }

      const record: Record<string, unknown> = {
        session_id,
        machine,
        session_date,
        agent: "claude-code",
        input_tokens,
        output_tokens,
        cache_read,
        cache_create,
        api_requests,
        fidelity: "exact",
        updated_at: new Date().toISOString(),
      };
      if (driver) record.driver = driver;
      if (notes) record.notes = notes.slice(0, 500);

      const { data, error } = await tb
        .from("token_sessions")
        .upsert(record, { onConflict: "session_id,machine" })
        .select("id, total_tokens")
        .single();

      if (error) {
        return { content: [{ type: "text" as const, text: `Failed to upsert: ${error.message}` }], isError: true };
      }

      return {
        content: [{ type: "text" as const, text: `upserted | id: ${data.id} | total_tokens: ${(data.total_tokens as number).toLocaleString()}` }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "record_chat_session",
  {
    title: "Record Chat Session",
    description:
      "Record estimated token usage for an Ariel (Claude Chat) session. Call at session closeout. Always inserts a new row — does not deduplicate.",
    inputSchema: {
      estimated_tokens: z.number().int().min(0).describe("Best estimate of total tokens for this session"),
      session_date:     z.string().optional().describe("Session date in YYYY-MM-DD format (UTC). Defaults to today."),
      driver:           z.string().optional().describe("Session driver: infrastructure | career | creative | markets | research | personal"),
      notes:            z.string().optional().describe("One-sentence description of what the session covered (max 500 chars)"),
    },
  },
  async ({ estimated_tokens, session_date, driver, notes }) => {
    try {
      const driverErr = validateDriver(driver);
      if (driverErr) {
        return { content: [{ type: "text" as const, text: driverErr }], isError: true };
      }

      const dateStr = session_date ?? new Date().toISOString().slice(0, 10);
      if (!validateDate(dateStr)) {
        return { content: [{ type: "text" as const, text: `Invalid session_date "${dateStr}". Use YYYY-MM-DD.` }], isError: true };
      }

      const sessionId = `ariel-${dateStr}-${crypto.randomUUID()}`;
      const record: Record<string, unknown> = {
        session_id:    sessionId,
        machine:       "ariel",
        session_date:  dateStr,
        agent:         "claude-chat",
        input_tokens:  estimated_tokens,
        output_tokens: 0,
        cache_read:    0,
        cache_create:  0,
        api_requests:  0,
        fidelity:      "estimated",
        updated_at:    new Date().toISOString(),
      };
      if (driver) record.driver = driver;
      if (notes) record.notes = notes.slice(0, 500);

      const { data, error } = await tb
        .from("token_sessions")
        .insert(record)
        .select("id")
        .single();

      if (error) {
        return { content: [{ type: "text" as const, text: `Failed to insert: ${error.message}` }], isError: true };
      }

      return {
        content: [{ type: "text" as const, text: `recorded | id: ${data.id} | estimated: ${estimated_tokens.toLocaleString()} tokens` }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "record_codex_session",
  {
    title: "Record Codex Session",
    description:
      "Record exact token usage for a Codex session. Call at session closeout. Upserts on (session_id, machine) — safe to call multiple times for the same session.",
    inputSchema: {
      session_id:     z.string().describe("Codex thread/session id, usually prefixed with codex-"),
      machine:        MACHINE_SCHEMA.describe(MACHINE_DESCRIPTION),
      session_date:   z.string().describe("Session date in YYYY-MM-DD format (Mountain time)"),
      input_tokens:   z.number().int().min(0).describe("Non-cached input tokens"),
      output_tokens:  z.number().int().min(0).describe("Output tokens"),
      cache_read:     z.number().int().min(0).describe("Cached input tokens"),
      cache_create:   z.number().int().min(0).describe("Cache creation tokens, 0 when unavailable"),
      api_requests:   z.number().int().min(0).describe("Count of Codex token-count events"),
      driver:         z.string().optional().describe("Session driver: infrastructure | career | creative | markets | research | personal"),
      notes:          z.string().optional().describe("Freeform session summary (max 500 chars)"),
    },
  },
  async ({ session_id, machine, session_date, input_tokens, output_tokens, cache_read, cache_create, api_requests, driver, notes }) => {
    try {
      const driverErr = validateDriver(driver);
      if (driverErr) {
        return { content: [{ type: "text" as const, text: driverErr }], isError: true };
      }
      if (!validateDate(session_date)) {
        return { content: [{ type: "text" as const, text: `Invalid session_date "${session_date}". Use YYYY-MM-DD.` }], isError: true };
      }

      const record: Record<string, unknown> = {
        session_id,
        machine,
        session_date,
        agent: "codex",
        input_tokens,
        output_tokens,
        cache_read,
        cache_create,
        api_requests,
        fidelity: "exact",
        updated_at: new Date().toISOString(),
      };
      if (driver) record.driver = driver;
      if (notes) record.notes = notes.slice(0, 500);

      const { data, error } = await tb
        .from("token_sessions")
        .upsert(record, { onConflict: "session_id,machine" })
        .select("id, total_tokens")
        .single();

      if (error) {
        return { content: [{ type: "text" as const, text: `Failed to upsert: ${error.message}` }], isError: true };
      }

      return {
        content: [{ type: "text" as const, text: `upserted | id: ${data.id} | total_tokens: ${(data.total_tokens as number).toLocaleString()}` }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const app = new Hono();

app.options("*", (c) => c.text("ok", 200, corsHeaders));

app.all("*", async (c) => {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
  }

  if (!c.req.header("accept")?.includes("text/event-stream")) {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Accept", "application/json, text/event-stream");
    const patched = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
      // @ts-ignore -- duplex required for streaming request bodies in Node's fetch (undici)
      duplex: "half",
    });
    Object.defineProperty(c.req, "raw", { value: patched, writable: true });
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

export default getRequestListener(app.fetch);

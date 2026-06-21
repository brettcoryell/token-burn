import { createClient } from "@supabase/supabase-js";
import type { ApiRequest, ApiResponse } from "./types";

const tb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
).schema('token_burn');

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { date, limit: limitParam } = req.query;

  if (date !== undefined) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date must be a YYYY-MM-DD date string" });
    }
  }

  const limit = Math.min(parseInt(String(limitParam ?? "50"), 10) || 50, 200);

  try {
    let q = tb
      .from("token_sessions")
      .select(
        "id, session_id, machine, session_date, agent, total_tokens, api_requests, driver, notes, fidelity, created_at"
      )
      .order("session_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (date) {
      q = q.eq("session_date", date);
    }

    const { data, error } = await q;

    if (error) {
      console.error("[api/sessions] Supabase error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data ?? []);
  } catch (err) {
    console.error("[api/sessions] Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

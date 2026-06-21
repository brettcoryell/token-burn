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

  const { since } = req.query;

  if (since !== undefined) {
    if (typeof since !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
      return res.status(400).json({ error: "since must be a YYYY-MM-DD date string" });
    }
  }

  try {
    const { data, error } = await tb.rpc("get_daily_summary", {
      since_date: since ?? null,
    });

    if (error) {
      console.error("[api/daily] Supabase error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data ?? []);
  } catch (err) {
    console.error("[api/daily] Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

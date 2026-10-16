import { getDatabase } from "../../../lib/database.mjs";
import { handleSignal } from "../../../lib/signal-service.mjs";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  return handleSignal(request, getDatabase());
}

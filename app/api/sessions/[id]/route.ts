import { getDatabase } from "../../../../lib/database.mjs";
import { handleSignal } from "../../../../lib/signal-service.mjs";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
type Context = { params: Promise<{ id: string }> };
async function handle(request: Request, context: Context) {
  return handleSignal(request, getDatabase(), (await context.params).id);
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;

// Temporary export on top of production edc6d98. No migrations or writes.
export const BACKUP_PATH = "/api/admin/ledger-backup";
export const INTERNAL_PATH = "/__admin/ledger-backup";
export const OWNER_ID = "5866034656";
export const EXPORT_UNTIL = Date.parse("2026-10-16T10:30:00Z");
const headers = {"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"};

function denied(request, env, now) {
  if (now >= EXPORT_UNTIL) return new Response("Export expired", {status:410, headers});
  if (!env.ANKETA_CALLBACK_TOKEN || request.headers.get("Authorization") !== "Bearer " + env.ANKETA_CALLBACK_TOKEN)
    return new Response("Forbidden", {status:403, headers});
  if (request.method !== "GET") return new Response("Method not allowed", {status:405, headers});
  if (new URL(request.url).search) return new Response("Query not allowed", {status:400, headers});
  return null;
}

export async function handleLedgerBackup(request, env, now = Date.now()) {
  const rejection = denied(request, env, now);
  if (rejection) return rejection;
  if (!env.ORDER_REMINDERS) return new Response("Binding unavailable", {status:503, headers});
  try {
    const id = env.ORDER_REMINDERS.idFromName("publication-credits:" + OWNER_ID);
    const stub = env.ORDER_REMINDERS.get(id);
    const response = await stub.fetch("https://reminder.internal" + INTERNAL_PATH, {
      method:"GET", headers:{Authorization:request.headers.get("Authorization")}
    });
    return new Response(response.body, {status:response.status, headers:{...headers,
      "Content-Type":"application/json", "Content-Disposition":"attachment; filename=admin-ledger.json"}});
  } catch {
    return new Response("Export failed; no backup confirmed", {status:503, headers});
  }
}

export async function readLedgerBackup(request, env, storage, now = Date.now()) {
  const rejection = denied(request, env, now);
  if (rejection) return rejection;
  // Do NOT call credits_status: it can seed or update a ledger.
  const ledger = await storage.get("credits_v1");
  if (ledger === undefined) return new Response("Existing ledger not found", {status:404, headers});
  return Response.json({format:"dame-camelias-owner-ledger-v1", capturedAt:new Date(now).toISOString(),
    sourceCommit:"edc6d98b2c6b8584e8f243812d0fcd431f5cd812", userId:OWNER_ID,
    objectName:"publication-credits:"+OWNER_ID, storageKey:"credits_v1", value:ledger,
    scope:"One owner credit record only; not a full Durable Objects namespace backup"}, {headers});
}

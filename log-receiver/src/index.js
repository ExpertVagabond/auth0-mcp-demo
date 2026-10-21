// Receives Auth0 log stream batches. Only event counts and event types are logged.
// Emails, IP addresses, and user IDs are never written anywhere.

function sameToken(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }
    if (request.method !== "POST" || url.pathname !== "/logs") {
      return new Response("not found", { status: 404 });
    }
    if (!env.LOG_STREAM_TOKEN || !sameToken(request.headers.get("authorization"), `Bearer ${env.LOG_STREAM_TOKEN}`)) {
      return new Response("unauthorized", { status: 401 });
    }

    let events;
    try {
      const parsed = JSON.parse(await request.text());
      events = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return new Response("body is not JSON", { status: 400 });
    }

    const types = {};
    for (const event of events) {
      const type = event?.type ?? event?.data?.type ?? "unknown";
      types[type] = (types[type] ?? 0) + 1;
    }
    console.log(JSON.stringify({ received: events.length, types }));
    return Response.json({ ok: true, received: events.length });
  },
};

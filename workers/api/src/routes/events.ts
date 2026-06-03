import { corsHeaders } from "../cors";
import { fetchEventsSince, getLatestEventCursor } from "../db/events";
import type { Env } from "../env";

export async function handleEventStream(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const cursorParam = url.searchParams.get("cursor");
  const pollMs = 800;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      // Without a cursor, start from the latest event so we don't replay history
      // (prevents lead count jumping 7→10 on page refresh).
      let lastCursor =
        cursorParam ??
        (await getLatestEventCursor(env.DB, env.ORGANIZATION_ID));

      const send = (data: unknown, eventId: string) => {
        const chunk = `id: ${eventId}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      };

      const ping = () => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      };

      try {
        for (let i = 0; i < 600; i++) {
          const events = await fetchEventsSince(
            env.DB,
            env.ORGANIZATION_ID,
            lastCursor,
            20
          );

          for (const event of events) {
            send({ event }, event.id);
            lastCursor = event.id;
          }

          if (events.length === 0) ping();
          await new Promise((r) => setTimeout(r, pollMs));
        }
      } catch {
        // client disconnected
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: corsHeaders(request, env, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    }),
  });
}

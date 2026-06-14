/**
 * Verify Telnyx webhook signatures using Ed25519.
 * Reference: https://developers.telnyx.com/docs/webhooks/signature-verification
 *
 * Telnyx signs every webhook with an Ed25519 key pair.
 * The public key is available in the Telnyx portal under:
 *   Messaging → Webhooks → (your webhook URL) → Public Key
 *
 * Required headers on each request:
 *   telnyx-signature-ed25519  — base64-encoded signature over `timestamp|body`
 *   telnyx-timestamp          — Unix timestamp (seconds)
 */
export async function verifyTelnyxWebhook(
  request: Request,
  publicKeyBase64: string
): Promise<boolean> {
  const signature = request.headers.get("telnyx-signature-ed25519");
  const timestamp = request.headers.get("telnyx-timestamp");

  if (!signature || !timestamp) {
    console.warn("Telnyx webhook missing signature or timestamp headers");
    return false;
  }

  // Reject stale webhooks older than 5 minutes to prevent replay attacks
  const tsSeconds = parseInt(timestamp, 10);
  if (isNaN(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > 300) {
    console.warn("Telnyx webhook timestamp out of acceptable range (>5 min)");
    return false;
  }

  const body = await request.clone().text();
  const payload = `${timestamp}|${body}`;

  try {
    const publicKeyBytes = Uint8Array.from(atob(publicKeyBase64), (c) =>
      c.charCodeAt(0)
    );
    const signatureBytes = Uint8Array.from(atob(signature), (c) =>
      c.charCodeAt(0)
    );
    const payloadBytes = new TextEncoder().encode(payload);

    const key = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"]
    );

    return await crypto.subtle.verify("Ed25519", key, signatureBytes, payloadBytes);
  } catch (e) {
    console.error("Telnyx signature verification error:", e);
    return false;
  }
}

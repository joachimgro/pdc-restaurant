/** Validate X-Twilio-Signature (HMAC-SHA1). https://www.twilio.com/docs/usage/security */
export async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): Promise<boolean> {
  const sortedKeys = Object.keys(params).sort();
  let payload = url;
  for (const key of sortedKeys) {
    payload += key + params[key];
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const raw = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );

  const expected = btoa(
    String.fromCharCode(...new Uint8Array(raw))
  );

  if (expected.length !== signature.length) return false;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) {
    ok |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return ok === 0;
}

export function parseTwilioForm(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  const search = new URLSearchParams(body);
  search.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/** Twilio expects 200 + empty TwiML so it does not auto-reply. */
export function twilioEmptyResponse(): Response {
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    }
  );
}

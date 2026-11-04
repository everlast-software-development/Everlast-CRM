// Inbound messages the webhook saves as plain TEXT but that the inbox draws as
// cards (see locationText / UNSUPPORTED_PREFIX in the API's
// modules/webhooks/webhook.controller.js — keep the formats in step).

// WhatsApp withheld the message (a poll, view-once photo, video note...): the
// webhook saved "[unsupported: <type>]" because there is no content to show.
export function isUnsupportedMessage(content: string | null | undefined): boolean {
  return Boolean(content?.startsWith("[unsupported"));
}

export const UNSUPPORTED_LABEL = "Unsupported message";

// "📍 Name\nAddress\nhttps://www.google.com/maps?q=lat,lng"
const MAPS_LINE_RE = /^https:\/\/www\.google\.com\/maps\?q=-?[\d.]+,-?[\d.]+$/;
export function parseLocationMessage(
  content: string | null | undefined,
): { name: string; address: string | null; url: string | null } | null {
  if (!content?.startsWith("📍 ")) return null;
  const lines = content.split("\n");
  const url = MAPS_LINE_RE.test(lines[lines.length - 1]) ? lines.pop()! : null;
  // Without a maps link it's just a patient's text that starts with a pin.
  if (!url) return null;
  return { name: lines[0].slice(3), address: lines.slice(1).join(", ") || null, url };
}

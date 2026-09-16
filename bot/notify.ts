/**
 * Sending a message to one user, from outside a bot update.
 *
 * Used by web-triggered flows — onboarding completing in a browser tab has to
 * announce itself back in the chat. Delivery failures are reported rather than
 * thrown: the wallet is already linked by the time we get here, and failing the
 * HTTP request would tell the user their setup broke when it did not.
 */

import { getBot, botConfigured } from "./bot";

export async function notifyUser(
  telegramId: bigint,
  text: string,
): Promise<{ sent: boolean; reason?: string }> {
  if (!botConfigured()) return { sent: false, reason: "bot not configured" };

  try {
    await getBot().api.sendMessage(String(telegramId), text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[notify] could not message user", { telegramId: String(telegramId), reason });
    return { sent: false, reason };
  }
}

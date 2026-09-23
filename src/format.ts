import { ApiError, SnapDeployApi } from "./api.js";

/** Turn a platform error into text the assistant can act on. The 402/429
 *  bodies are product moments, not bugs: relay the platform's own message,
 *  action link and CTA verbatim, and tell the assistant NOT to retry. */
export function apiErrorToText(err: unknown, api: SnapDeployApi): string {
  if (!(err instanceof ApiError)) {
    return `Request failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  const b = err.body ?? {};
  const msg = b.message || b.error || "";

  if (err.status === 402) {
    // Some 402 bodies carry redirectUrl instead of actionUrl (add-on create).
    const url = b.actionUrl ?? b.redirectUrl;
    const cta = b.actionText ?? "Purchase";
    const lines = [
      "PAYMENT REQUIRED (402) — this is a plan limit working as designed, not a bug.",
      msg && `SnapDeploy says: ${msg}`,
      url && `→ ${cta}: ${api.absolute(url)}`,
    ];
    if (b.spareSubscriptionId) {
      lines.push(
        `The account already has an UNASSIGNED Always-On subscription that fits this container ` +
          `(subscriptionId: ${b.spareSubscriptionId}). Ask the user to confirm, then call ` +
          `assign_always_on with that subscriptionId and the containerId — it attaches and starts the container.`
      );
    }
    lines.push(
      "Do NOT retry this call and do NOT try to work around it — the same block will answer until the action above is taken. Relay the message and link to the user."
    );
    return lines.filter(Boolean).join("\n");
  }

  if (err.status === 429) {
    if (b.error === "DEPLOY_CAP_REACHED" || b.reason === "DEPLOY_CAP_REACHED") {
      return [
        "DEPLOY LIMIT REACHED (429) — free accounts get 5 deploys per rolling 12 hours, and failed attempts count.",
        msg && `SnapDeploy says: ${msg}`,
        b.actionText && b.actionUrl && `→ ${b.actionText}: ${api.absolute(b.actionUrl)}`,
        "A $1 Sprint Pack lifts the limit for 24 hours; Always-On removes it. Do NOT retry — tell the user and stop.",
      ]
        .filter(Boolean)
        .join("\n");
    }
    return "RATE LIMITED (429). Wait at least 60 seconds before the next call; do not tight-loop.";
  }

  if (err.status === 403 && b.error === "INSUFFICIENT_SCOPE") {
    const need = b.requiredScope ?? "a higher";
    return (
      `REFUSED (403): this token does not have the '${need}' scope needed for that action. ` +
      `Tell the user to create a token with the '${need}' scope on the API Keys page (scopes nest: read ⊂ deploy ⊂ manage) ` +
      `and update the connector's SNAPDEPLOY_API_KEY. Do not retry with this token.`
    );
  }

  if (err.status === 403 && (b.error === "INTERACTIVE_SESSION_REQUIRED" || /interactive/i.test(msg))) {
    return (
      "REFUSED (403): this action is deliberately impossible for API keys and agents. " +
      "Deleting things, changing the password and cancelling subscriptions require a person " +
      "signed in to the SnapDeploy web or mobile app. Do not look for a workaround — tell the user to do it in the UI."
    );
  }

  if (err.status === 401) {
    return "UNAUTHORIZED (401): the SNAPDEPLOY_API_KEY is missing, wrong or revoked. The user can check it at /api-keys.";
  }

  const detail = typeof b === "object" ? JSON.stringify(b).slice(0, 800) : String(b);
  return `SnapDeploy API error ${err.status} on ${err.path}: ${msg || detail}`;
}

/**
 * Structured relay envelope for inter-agent messages.
 *
 * Design draws from agent-to-agent standards research (see envelope-research.md):
 * - source/target identity from AutoGen, A2A protocol
 * - dispatchId correlation from A2A contextId pattern
 * - createdAt timestamp from CloudEvents
 * - content/envelope separation from CloudEvents data principle
 * - type discriminator from CloudEvents type field
 *
 * See design-decisions.md §12 for field rationale and excluded fields.
 */

export interface RelayEnvelope {
  /** Who produced this message (agent ID, e.g., "ceo" on dispatch, "systems-eng" on result). */
  source: string;
  /** Who receives this message (agent ID). */
  target: string;
  /** Correlation ID linking dispatch to result. */
  dispatchId: string;
  /** ISO 8601 timestamp of envelope creation. */
  createdAt: string;
  /** Direction: dispatch (orchestrator → subagent) or result (subagent → orchestrator). */
  type: "dispatch" | "result";
  /** The payload — task prompt on dispatch, assistantTexts[last] on result. */
  content: string;
}

/**
 * Serialize envelope for gateway injection (result → orchestrator).
 *
 * Machine-to-machine context: the orchestrator receives this as an internal
 * `role: "user"` message via `openclaw gateway call agent`. Uses agent IDs
 * (not session keys) for readable provenance.
 */
export function serializeForGateway(
  envelope: RelayEnvelope,
  opts?: { subagentSessionKey?: string; replyInstruction?: string }
): string {
  const lines = [
    `[System Message] [relay-dispatch: ${envelope.dispatchId}]`,
    `Relay result from ${envelope.source} → ${envelope.target}`,
    "",
    "Result:",
    envelope.content,
    "",
    `[relay_dispatch_id:${envelope.dispatchId}]`
  ];

  if (opts?.subagentSessionKey) {
    lines.push(`[relay_subagent_session_key:${opts.subagentSessionKey}]`);
  }

  if (opts?.replyInstruction) {
    lines.push("", opts.replyInstruction);
  }

  return lines.join("\n");
}

/**
 * Serialize envelope for Discord channel posting (dispatch → subagent).
 *
 * Human-readable context: task content is prominent, envelope metadata
 * in a compact footer. Overhead is ~80-100 chars for the footer.
 */
export function serializeForDiscord(
  envelope: RelayEnvelope,
  opts?: { mentionUserId?: string }
): string {
  const mention = opts?.mentionUserId ? `<@${opts.mentionUserId}>\n` : "";
  const footer = `\n\nfrom ${envelope.source}`;
  return `${mention}${envelope.content}${footer}`;
}

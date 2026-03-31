# Agent Message Envelope — Standards Research

Research conducted 2026-02-28. Context: CTO (systems-eng) suggested a relay message schema with identity, provenance, and HMAC. Before designing our own, we surveyed existing standards and patterns to avoid under-engineering for a project intended to be shared.

---

## Surveyed Standards

### 1. Google A2A Protocol (Agent-to-Agent)

**Source:** Linux Foundation / Google, released 2025

The most directly relevant standard. A2A defines a full agent-to-agent communication protocol with JSON-RPC transport.

**Key models:**
- **`Task`** — lifecycle object with `id`, `contextId` (conversation thread), `status` (submitted → working → input-required → completed → failed → canceled), `history` (list of Messages)
- **`Message`** — `role: "user" | "agent"`, `parts: Part[]`, `metadata: Record<string, string>`, `taskId`, `contextId`
- **`AgentCard`** — identity/discovery document at `/.well-known/agent.json`, includes capabilities, authentication, skills
- **`contextId`** — links messages across exchanges within a logical conversation thread (maps well to our `dispatchId`)

**Relevant patterns:**
- Structured envelope with explicit `role` and typed `parts` (text, file, data)
- `contextId` for correlating multi-turn exchanges across agents
- Task lifecycle with explicit status transitions
- `metadata` as an open extension point

**Fit for relay:** High. The `Task` lifecycle maps directly to our dispatch lifecycle. The `contextId` pattern validates our `dispatchId` approach. The `Message` schema with typed `parts` is more structured than our current plain-text envelope.

### 2. AutoGen (Microsoft)

**Source:** Microsoft Research, actively maintained

Multi-agent conversation framework with a simple, pragmatic message model.

**Key patterns:**
- **`source: string`** — every message carries its sender identity as a top-level field
- **`metadata: dict[str, str]`** — arbitrary key-value pairs for extension
- **`HandoffMessage`** — special message type for delegation between agents, includes `target` and `content`
- **Routing via `TopicSubscription`** — agents subscribe to topics, messages routed by topic-agent mapping

**Fit for relay:** Medium. The `source` field and `HandoffMessage` pattern are directly applicable. The topic subscription model maps to our channel-agent mapping. Simpler than A2A but less formally specified.

### 3. OpenAI Agents SDK

**Source:** OpenAI, 2025

Focus on handoffs between agents in a single orchestration.

**Key patterns:**
- **`context_variables: dict[str, Any]`** — shared mutable state passed between agents during handoffs
- **Handoff as a tool call** — delegation modeled as a function call, similar to our `relay_dispatch` tool
- **`input_guardrails` / `output_guardrails`** — validation functions that run before/after agent processing

**Fit for relay:** Low-medium. The handoff-as-tool-call pattern validates our approach. The `context_variables` pattern is interesting for future cross-dispatch state but not immediately needed.

### 4. IETF Drafts (Emerging)

Three relevant Internet-Drafts, all still in progress:

**a) `agent://` URI Scheme (draft-bichsel-agent-protocol)**
- Defines a URI scheme for addressing agents
- **`X-Delegation-Chain`** header — ordered list of agents in a delegation path (e.g., `agent://ceo > agent://cto`)
- **`X-Request-Id`** — unique per-request correlation
- Strong identity model with agent URIs

**b) `agentic-jwt` (draft-singh-agentic-jwt)**
- Extends JWT for agent-to-agent authentication
- **`agent_checksum`** — integrity hash of agent code/config
- **`intent.delegation_chain`** — delegation provenance in the token itself
- **`scope`** field for permission boundaries

**c) Agent Networks Framework (draft-goel-bichsel-agent-networks)**
- Higher-level framework for agent network topologies
- Defines trust boundaries and message validation patterns

**Fit for relay:** The `delegation_chain` concept from both drafts is directly useful — it solves the provenance question (who asked whom to do what). The JWT-based authentication is over-engineered for our single-system use case but useful if the relay ever crosses trust boundaries.

### 5. Model Context Protocol (MCP)

**Source:** Anthropic, 2024-2025

Not an agent-to-agent protocol, but relevant for its metadata conventions.

**Key pattern:**
- **`_meta: Record<string, unknown>`** — reserved property on any MCP object for implementation-specific metadata. The `_` prefix signals "system/framework reserved, not user content."
- **Capability negotiation** — clients and servers declare what they support
- **Tool schemas** — JSON Schema for tool parameters (we already use TypeBox, which generates JSON Schema)

**Fit for relay:** The `_meta` convention is clean and adoptable. Having a reserved namespace for relay metadata prevents collision with content fields.

### 6. CloudEvents (CNCF)

**Source:** Cloud Native Computing Foundation, stable specification

Event envelope standard for cloud-native systems.

**Key pattern:**
- **Strict envelope/data separation** — context attributes (`source`, `type`, `id`, `time`, `subject`) are distinct from `data` (the payload)
- **`source`** — URI identifying the event producer
- **`type`** — reverse-DNS event type (e.g., `com.clawsuite.relay.dispatch`)
- **`subject`** — the thing the event is about (e.g., the target agent)
- **Extension attributes** — namespaced additional context

**Fit for relay:** High for structural inspiration. The envelope/data separation is exactly right — our current trigger message mixes metadata markers with content. CloudEvents' approach of keeping envelope attributes separate from payload would clean up the trigger message format.

### 7. Other Patterns Observed

**Matterbridge** — Cross-platform chat bridge. Uses a `[{PROTOCOL}] <{NICK}>` attribution prefix for provenance. Simple but effective for display. Our `[System Message] [relay-dispatch: ...]` prefix follows a similar pattern.

**Discord embeds** — Structured metadata via embed fields, separate from message text. Could carry provenance and correlation data without polluting the text content. Not usable for gateway injection (which is text-only), but relevant for channel-visible messages.

**FIPA ACL** — IEEE Foundation for Intelligent Physical Agents. Academic standard for agent communication. Defines performatives (inform, request, agree, refuse) and conversation protocols. Theoretically comprehensive but not adopted by modern agent frameworks.

---

## Patterns to Adopt

Based on the research, these patterns have the strongest fit for ClawSuite-Relay:

### Must-adopt (address real problems)

| Pattern | Source | Why |
|---|---|---|
| **Envelope/data separation** | CloudEvents | Our trigger message currently mixes `[relay_dispatch_id:]` markers with `Result:` content. Separating them improves parseability and prevents metadata from polluting content. |
| **`source` field** | AutoGen, CloudEvents, A2A | Every relay message should identify its sender. Currently implicit (the relay bot posts it). Should be explicit in the envelope. |
| **`contextId` / correlation** | A2A | We already have `dispatchId`. Validating it as a first-class correlation concept (not just a tag). |
| **`delegationChain`** | IETF agent:// | For provenance: `["ceo", "systems-eng"]` tells anyone inspecting the message who asked whom. Important for the transparency goal. |

### Should-adopt (improve design quality)

| Pattern | Source | Why |
|---|---|---|
| **`_meta` reserved namespace** | MCP | Clean separation of relay system metadata from content fields. |
| **Typed message parts** | A2A | Future-proofing: when the relay carries file attachments or structured data, typed parts prevent ad-hoc format proliferation. Not needed in Phase 2 but cheap to design in now. |
| **Task lifecycle status** | A2A | Our dispatch states (PENDING → CAPTURED → FORWARDED → FAILED) already map to A2A's task statuses. Formalizing this alignment makes the relay legible to anyone familiar with A2A. |

### Defer (over-engineering for now)

| Pattern | Source | Why defer |
|---|---|---|
| **HMAC / signing** | CTO suggestion, agentic-jwt | Single-system deployment. All components run on the same host with the same user. Adding cryptographic signing adds complexity without security benefit until the relay crosses trust boundaries. |
| **`agent://` URIs** | IETF draft | Formal agent addressing is useful for discovery and routing across systems. Within our Discord-mediated single-guild setup, agent IDs (`"systems-eng"`) are sufficient. |
| **JWT authentication** | agentic-jwt | Same reasoning as HMAC — no trust boundary crossing in current architecture. |
| **Capability negotiation** | MCP | Relay targets are statically configured. Dynamic capability discovery adds complexity without current benefit. |

---

## Recommended Envelope Structure

Drawing from the standards above, a relay envelope that balances structure with simplicity:

```typescript
interface RelayEnvelope {
  // Identity (from AutoGen, CloudEvents, A2A)
  source: string;               // sender agent ID, e.g., "ceo"
  target: string;               // receiver agent ID, e.g., "systems-eng"

  // Correlation (from A2A contextId, IETF X-Request-Id)
  dispatchId: string;           // unique per-dispatch, already implemented
  contextId?: string;           // optional: links related dispatches in a logical thread

  // Provenance (from IETF agent:// delegation_chain)
  delegationChain: string[];    // e.g., ["president", "ceo", "systems-eng"]

  // Temporal (from CloudEvents)
  createdAt: string;            // ISO 8601 timestamp

  // Content (from A2A Message, CloudEvents data separation)
  type: "dispatch" | "result";  // message direction
  content: string;              // the task prompt or result text

  // Extension (from MCP _meta)
  _meta?: Record<string, string>;  // relay system metadata (session keys, message IDs, etc.)
}
```

### How this maps to current implementation

| Current | Proposed | Change |
|---|---|---|
| `[relay_dispatch_id:xxx]` marker in text | `envelope.dispatchId` | Moves from in-band text marker to structured field |
| `[relay_subagent_message_id:xxx]` | `envelope._meta.subagentMessageId` | Moves to `_meta` extension |
| `[relay_subagent_session_key:xxx]` | `envelope._meta.sessionKey` | Moves to `_meta` extension |
| Implicit sender (relay bot posts it) | `envelope.source` | Explicit sender identity |
| No delegation tracking | `envelope.delegationChain` | New: provenance chain |
| `Result:\n<text>` in trigger message | `envelope.content` | Clean separation |

### Serialization considerations

The envelope needs to work in two contexts:

1. **Discord channel messages** (outbound dispatch prompt) — must be human-readable. Options:
   - JSON code block in Discord message (parseable + readable)
   - Structured embed fields (Discord-native, but not available to all consumers)
   - Current approach: markers + plain text (simple, but mixes metadata with content)

2. **Gateway injection** (return path) — not human-visible, pure machine-to-machine. Options:
   - JSON string as the `message` parameter (cleanest)
   - Current approach: formatted text with markers (works but ad-hoc)

The gateway path should adopt JSON serialization. The Discord path is a design choice between readability and structure — can be addressed when implementing the outbound envelope.

---

## Changelog
- 2026-02-28: Initial research covering A2A, AutoGen, OpenAI Agents SDK, IETF drafts, MCP, CloudEvents, Matterbridge, Discord embeds, FIPA ACL. Recommended envelope structure proposed.

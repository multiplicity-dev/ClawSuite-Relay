# When Your AI Agents Start Talking to Each Other

*How a Discord relay made multi-agent orchestration transparent — and what we learned along the way*

---

## The Problem No One Warns You About

If you run multiple AI agents in OpenClaw — a CEO orchestrator delegating to specialist subagents — you have a visibility problem you may not realize exists.

When your orchestrator spawns a subagent task, the subagent works in a transient session. It reasons, runs tools, produces output. The orchestrator receives a summary. You, the human, see the orchestrator's synthesis in your channel. Everything looks smooth.

But where did the subagent's actual work happen? In a JSONL file buried in `~/.openclaw/agents/`. What does the subagent remember about this work? Nothing — the session was transient. Can you audit what the orchestrator actually asked? Not without parsing files. If the orchestrator's summary is wrong, who catches it? No one, because no one can see the exchange.

We called this the *double-blind problem*. The orchestrator forgets what it delegated. The subagent doesn't know what was delegated to it. The human can't audit either side. Errors propagate silently.

## The Idea: Make It Visible

The fix seemed straightforward: instead of spawning subagents in hidden transient sessions, route the orchestrator's task through the subagent's Discord channel. The prompt appears as a visible message in #tech. The CTO responds there, in its main session. Everyone can see it. The CTO remembers it. The orchestrator gets the response back and synthesizes.

We called it ClawSuite-Relay. A second Discord bot (OpenClaw drops its own bot's messages, so you need a separate identity), an OpenClaw plugin with hooks, some dispatch state management. The outbound leg — orchestrator's prompt posted to the subagent's channel — worked on the first serious attempt.

The return leg nearly broke us.

## The First Convergence

The most memorable moment came during live testing. I was working in two channels simultaneously — in #tech with the CTO (played by GPT-5.3 at the time) debugging the capture hooks, and in #general with the CEO, sending probe prompts and watching for the response to come back through the relay.

The loop was sputtering. Messages were getting through intermittently. And then something shifted. As we got closer to a stable loop, both agents started commenting on the same events. The CTO would report "I see a relay dispatch arriving" and the CEO would say "I'm receiving a response from the CTO." Their observations began converging — each independently reporting what the other had just done, without me explaining.

They were communicating. Through a channel I had built. It was the first time I'd seen two AI agents coordinate through infrastructure I'd designed, and despite the bugs and the broken state, I could feel the architecture was right.

## Where GPT-5.3 Hit the Wall

GPT-5.3 (the CTO at the time) was fast. It scaffolded the project, wrote the dispatch contract, built the state management, wired up the Discord transport. In a single session it went from zero to "relay bot posts to channel and CTO responds." Impressive velocity.

But the return path — capturing the subagent's response and forwarding it back — became a death spiral. The problem looked like an extraction issue: which hook captures assistant text? `message_sending`? `before_message_write`? `agent_end`? Each hook seemed to work, then didn't. GPT would switch hooks, add guards, remove guards, re-add the previous hook alongside the new one, creating interference patterns. Each change fixed one test and broke another.

The deeper problem was discipline. Without rigorous evidence tracking, each iteration started from slightly wrong assumptions. A fix that appeared to work might have been a false positive — the hook fired, content was forwarded, but was it the *right* content? Was it assistant text or channel-visible text or a relay envelope echoing back? The code accumulated layers of extraction logic, echo guards, duplicate detection, and mode switches. By the late sessions, six different hooks were wired simultaneously with overlapping guards.

When I enforced a structured workflow — one change, one test, one evidence entry — the flailing stopped. But the underlying confusion remained: we didn't fully understand what we were trying to capture.

## Sleeping On It

After two days of hook cycling, even the AI suggested we might need to reconsider the approach. I went to sleep.

When I came back, I did two things.

First, I dispatched Claude (Opus 4.6) on deep research into OpenClaw's internals. Not "try this hook" — but "trace the source code from model output to channel delivery and tell me exactly what each data surface contains." Claude came back with a detailed analysis that used the word *surface* to describe the four independent access paths to subagent output, even though I'd been using *layer* (which implied a hierarchy that didn't exist).

Second, I sat down and thought about the problem end-to-end. The outbound path worked. Capture worked — we had confirmed this multiple times with multiple hooks. So what was failing?

The answer was embarrassingly simple: we had no *vehicle* for the assistant text. Every hook captured the right data. Every forward delivered it — as a Discord message to #general. And a Discord message carries only channel-visible text. We were optimizing the capture side of a *delivery* problem. No matter how perfectly we extracted assistant text, posting it as a Discord message reduced it back to channel output.

The surface metaphor suddenly clicked. These weren't layers stacking on each other. They were independent views. The channel output and the completion announce both derived from the same source (`assistantTexts` array), filtered differently. We needed a second delivery path — one that matched what OpenClaw's native `sessions_spawn` used internally: gateway injection.

## The Solution Was Already There

Claude's research had uncovered the exact mechanism: `openclaw gateway call agent` — a CLI wrapper around the same gateway RPC that `sendSubagentAnnounceDirectly` uses natively. We could inject a trigger message directly into the orchestrator's session, formatted like a completion announce, carrying the assistant text without touching Discord.

The implementation took a few hours. A tool factory pattern to capture the orchestrator's session key at dispatch time. A `GatewayForwardTransport` that shells out to the gateway CLI. The `llm_output` hook as the sole capture path — OpenClaw's purpose-built API for assistant text, providing the data pre-extracted as `string[]`.

When we tested it, the delivery bypassed Discord entirely. A 4,001-character response arrived intact — no splitting, no truncation — while the channel showed it split across three messages. The orchestrator received the same content scope as a native `sessions_spawn` completion announce.

## The Discriminating Test Problem

One thing that kept us stuck was test design. The AI excels at functional tests — "does the hook fire? does the content arrive? does the state transition?" But the relay's failure mode was subtle: content *did* arrive, it just wasn't the *right* content. Channel-visible text looks very similar to assistant text for simple responses.

What we needed were *discriminating tests* — prompts designed so the outcome differs depending on which data surface the orchestrator received. The AI-generated test prompts kept asking the subagent to "show your step-by-step reasoning" — which meant the channel output *already contained* the reasoning, making the test unable to distinguish between delivery paths. Every test came back positive regardless of whether the relay was working correctly.

The fix was asking the orchestrator to *explain how the subagent arrived at the answer*. If the orchestrator received only the final answer ("1"), it would have to admit it couldn't explain the reasoning. If it received the full working, it could explain. This asymmetric design made the test conclusive in both directions. The orchestrator reported: "The relay delivered only 1. I did not receive CTO's reasoning process." — which told us exactly what we needed to know.

It turned out the answer *was* correct. `assistantTexts[last]` is the final visible text, thinking tokens stripped. That's what the native completion announce delivers too. The relay wasn't losing content — it was delivering exactly what it should. The "richer content" that distinguishes the orchestrator's synthesis from a raw dump comes from how the CEO prompts the subagent, not from some hidden data surface.

## What the Relay Actually Achieves

The relay changes three things, none of which are about delivering "more data":

**Transparency.** The president can read any subagent channel and see exactly what the orchestrator asked and what the subagent answered. No parsing JSONL files. No trusting the orchestrator's synthesis blindly.

**Continuity.** The subagent works in its main channel session, not a throwaway. When you talk to the CTO directly later, it remembers the orchestrator-dispatched work. The "subagent amnesia" problem disappears.

**Context access.** Because the relay operates on the main session, the orchestrator can call `sessions_history` with the subagent's session key and a small `limit` to see recent working — not just the current task, but accumulated context from prior dispatches and direct conversations. This is arguably *more* valuable than native `sessions_spawn`, where each transient session starts from zero.

The content delivered to the orchestrator is identical in scope to what it would receive natively. The channel output is richer for multi-step tasks — multiple Discord messages showing the subagent's full response — while the orchestrator receives only the final answer, keeping its context clean for cross-agent synthesis. This is by design, not a limitation.

## Lessons

**Understand the system before optimizing within it.** We spent two days cycling hooks because we didn't understand the four data surfaces or how they related. Thirty minutes of source code tracing resolved a problem that dozens of hook permutations couldn't.

**Test design matters as much as code.** A test that can't distinguish between success and failure is worse than no test — it generates false confidence. The discriminating test principle (design the prompt so the outcome differs between hypotheses) should be applied early, not as a last resort.

**Document aggressively, especially during debugging.** When three AI models across multiple sessions are making changes, institutional memory evaporates. The structured workflow — one change, one test, one evidence entry — sounds bureaucratic until you're on your third day trying to remember which hook produced which result.

**The surface metaphor over the layer metaphor.** Data doesn't stack. It fans out through independent views with different filters. Understanding this distinction collapsed a complex debugging problem into a simple architectural one.

**Sleep on it.** Sometimes the best debugging tool is a night's rest and a fresh systematic trace from first principles.

---

*ClawSuite-Relay is an OpenClaw plugin that routes orchestrator delegation through subagent Discord channels for transparent, persistent, auditable multi-agent orchestration. The source code, design documentation, and this story are available at [repo link].*

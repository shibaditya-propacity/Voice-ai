# Voice Agent v2 — Streaming Architecture

## New Call Flow

```
Caller
  ↓ (PSTN)
Twilio
  ↓ POST /voice/incoming (HTTP webhook)
  ← TwiML: <Connect><Stream url="wss://host/media-stream" />
  ↓ WebSocket opens to /media-stream
Audio Gateway (audio-gateway.ts)
  ↓ μ-law 8kHz audio frames (base64, 20ms/frame)
Krisp Processor (passthrough until SDK configured)
  ↓ clean audio
VAD (vad.ts) — energy-based, runs EVERY frame
  ├── speech_start → emit USER_STARTED_SPEAKING
  │     └── if agent was speaking → emit BARGE_IN_DETECTED → abort TTS + clear Twilio buffer
  └── speech_end  → emit USER_STOPPED_SPEAKING
Deepgram STT — streaming, receives audio in parallel with VAD
  ├── interim → emit PARTIAL_TRANSCRIPT
  └── final   → emit FINAL_TRANSCRIPT
Conversation Orchestrator (orchestrator.ts) — deterministic
  ↓ FINAL_TRANSCRIPT received
  ├─1─ Planner Agent (Claude, structured JSON, ~200ms)
  │      → intent, tool_required, tool_name, parameters
  ├─2─ Tool Router (parallel, ~300-500ms if needed)
  │      → Circuit breaker + retries
  │      → DB queries: property search, site visit booking, lead update
  └─3─ Response Agent (Claude streaming, first token ~200ms)
         ↓ text tokens
       Speech Chunker (splits at sentence boundaries)
         ↓ 30-200 char chunks
       ElevenLabs WebSocket (ulaw_8000 output, ~150ms first audio)
         ↓ μ-law audio chunks
       Audio Gateway → Twilio WebSocket → Caller
```

## Key Design Principles

1. **LLM never orchestrates** — Claude only: reasons, plans, generates speech
2. **Deterministic orchestration** — all routing/state/lifecycle is code
3. **Event-driven** — every component communicates via typed events
4. **Streaming everywhere** — STT streams in, LLM streams, TTS streams out
5. **Barge-in first** — user speech immediately stops agent audio
6. **Parallel execution** — TTS opened before LLM starts, tools run in parallel

## Latency Budget (target < 1000ms E2E)

| Stage | Target |
|-------|--------|
| VAD speech-end detection | ~0ms (immediate) |
| Deepgram final transcript | 200-300ms |
| Planner Agent (Claude) | 150-300ms |
| Tool execution (if needed) | +300-500ms |
| Response Agent first token | 200-350ms |
| ElevenLabs first audio chunk | 150-200ms |
| **E2E (no tools)** | **~700-900ms** |
| **E2E (with tools)** | **~1200-1500ms** |

## New Environment Variables

```
DEEPGRAM_API_KEY=    # Required — streaming STT
KRISP_API_KEY=       # Optional — noise cancellation
REDIS_URL=           # Optional — distributed session store
```

## Twilio Configuration

Set your Twilio phone number's voice webhook to:
```
POST https://your-domain.com/voice/incoming
```

Status callback:
```
POST https://your-domain.com/voice/status
```

The Media Stream WebSocket is at:
```
wss://your-domain.com/media-stream
```
(auto-connected via TwiML — no manual configuration needed)

/**
 * @deprecated — Superseded by the streaming architecture in v2.
 *
 * This controller was part of the HTTP-webhook polling architecture
 * (POST /voice/gather → Claude → ElevenLabs → file → Twilio).
 *
 * In v2, all conversation processing happens over the Twilio Media
 * Streams WebSocket at /media-stream. See audio-gateway.ts.
 *
 * Kept for reference only — not imported or used.
 */
export {};

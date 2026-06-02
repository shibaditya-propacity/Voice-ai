/**
 * speech-chunker.ts — Splits streaming LLM output into TTS-ready chunks.
 *
 * PROBLEM: If we wait for the full LLM response before calling TTS, latency is:
 *   LLM_TOTAL_TIME + TTS_TOTAL_TIME (sequential, terrible)
 *
 * SOLUTION: Feed text chunks to TTS as they stream from LLM:
 *   Chunk 1 → TTS while Chunk 2 is still generating (parallel, fast)
 *
 * Chunking strategy:
 *   1. Sentence boundary detection (. ! ? at natural pause points)
 *   2. Minimum chunk length (avoid tiny chunks causing TTS latency spikes)
 *   3. Hard character limit for very long sentences
 *
 * Output chunks are natural speech segments that sound good when spoken
 * independently — no mid-word or mid-phrase splits.
 */

// Sentence boundary regex — matches end of sentence with trailing space or end-of-string
const SENTENCE_BOUNDARY = /([.!?।॥]["\s]|[.!?।॥]$)/;

// Soft boundary (comma, dash) used when sentence is getting too long
const SOFT_BOUNDARY = /([,;—–]\s)/;

const MIN_CHUNK_CHARS = 30;   // Don't chunk until we have at least this many chars
const MAX_CHUNK_CHARS = 200;  // Force a chunk if this many chars accumulated

export interface ChunkerConfig {
  minChunkChars?: number;
  maxChunkChars?: number;
}

export class SpeechChunker {
  private buffer = '';
  private readonly minChunk: number;
  private readonly maxChunk: number;

  constructor(config: ChunkerConfig = {}) {
    this.minChunk = config.minChunkChars ?? MIN_CHUNK_CHARS;
    this.maxChunk = config.maxChunkChars ?? MAX_CHUNK_CHARS;
  }

  /**
   * Feed an LLM text token/chunk into the chunker.
   * Returns an array of ready-to-speak chunks (may be empty if more context needed).
   */
  push(text: string): string[] {
    this.buffer += text;
    return this.extractChunks();
  }

  /**
   * Flush remaining buffer on LLM completion — returns leftover text as final chunk.
   */
  flush(): string[] {
    const chunks: string[] = [];
    const remaining = this.buffer.trim();
    if (remaining.length > 0) {
      chunks.push(...this.splitIfLong(remaining));
    }
    this.buffer = '';
    return chunks;
  }

  reset(): void {
    this.buffer = '';
  }

  private extractChunks(): string[] {
    const chunks: string[] = [];

    while (true) {
      if (this.buffer.length < this.minChunk) break;

      // Try hard sentence boundary first
      const sentenceMatch = SENTENCE_BOUNDARY.exec(this.buffer);
      if (sentenceMatch && sentenceMatch.index + sentenceMatch[0].length >= this.minChunk) {
        const cutAt = sentenceMatch.index + sentenceMatch[0].length;
        const chunk = this.buffer.slice(0, cutAt).trim();
        if (chunk.length > 0) chunks.push(chunk);
        this.buffer = this.buffer.slice(cutAt).trimStart();
        continue;
      }

      // Force chunk at max length to avoid TTS buffering too much text
      if (this.buffer.length >= this.maxChunk) {
        // Try soft boundary within the first maxChunk chars
        const searchArea = this.buffer.slice(0, this.maxChunk);
        const softMatch = SOFT_BOUNDARY.exec(searchArea);

        let cutAt: number;
        if (softMatch && softMatch.index >= this.minChunk) {
          cutAt = softMatch.index + softMatch[0].length;
        } else {
          // No good boundary — cut at max with word boundary
          const wordBoundary = this.buffer.lastIndexOf(' ', this.maxChunk);
          cutAt = wordBoundary > this.minChunk ? wordBoundary + 1 : this.maxChunk;
        }

        const chunk = this.buffer.slice(0, cutAt).trim();
        if (chunk.length > 0) chunks.push(chunk);
        this.buffer = this.buffer.slice(cutAt).trimStart();
        continue;
      }

      break; // Need more text
    }

    return chunks;
  }

  private splitIfLong(text: string): string[] {
    if (text.length <= this.maxChunk) return [text];

    const parts: string[] = [];
    let remaining = text;

    while (remaining.length > this.maxChunk) {
      const wordBound = remaining.lastIndexOf(' ', this.maxChunk);
      const cutAt = wordBound > 0 ? wordBound : this.maxChunk;
      parts.push(remaining.slice(0, cutAt).trim());
      remaining = remaining.slice(cutAt).trimStart();
    }

    if (remaining.trim().length > 0) parts.push(remaining.trim());
    return parts;
  }
}

/**
 * One-shot helper: split a complete response into TTS chunks.
 * Used when you have the full response (e.g. from cache).
 */
export function splitResponseIntoChunks(text: string, config?: ChunkerConfig): string[] {
  const chunker = new SpeechChunker(config);
  const chunks = chunker.push(text);
  chunks.push(...chunker.flush());
  return chunks.filter(c => c.length > 0);
}

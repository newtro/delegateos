/**
 * SSE utilities — writer for ServerResponse and reader for incoming streams.
 */

import type { ServerResponse } from 'node:http';
import type { SSEEvent } from './types.js';

/**
 * Writes SSE frames to an HTTP response.
 */
export class SSEWriter {
  private closed = false;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private res: ServerResponse,
    keepAliveMs = 15_000,
  ) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    this.keepAliveTimer = setInterval(() => {
      if (!this.closed) {
        this.res.write(':keep-alive\n\n');
      }
    }, keepAliveMs);

    res.on('close', () => this.close());
  }

  send(event: SSEEvent): void {
    if (this.closed) return;
    let frame = '';
    if (event.id) frame += `id: ${event.id}\n`;
    if (event.retry !== undefined) frame += `retry: ${event.retry}\n`;
    frame += `event: ${event.event}\n`;
    // SSE data lines — split on newlines
    for (const line of event.data.split('\n')) {
      frame += `data: ${line}\n`;
    }
    frame += '\n';
    this.res.write(frame);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    try { this.res.end(); } catch { /* already closed */ }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

/**
 * Parses SSE events from a readable text stream (e.g. fetch response body).
 */
export class SSEReader {
  constructor(private stream: ReadableStream<Uint8Array>) {}

  async *events(): AsyncGenerator<SSEEvent> {
    const reader = this.stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent: Partial<SSEEvent> = {};

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop()!; // incomplete line stays in buffer

        for (const line of lines) {
          if (line === '') {
            // Empty line = event boundary
            if (currentEvent.event && currentEvent.data !== undefined) {
              yield currentEvent as SSEEvent;
            }
            currentEvent = {};
          } else if (line.startsWith('event: ')) {
            currentEvent.event = line.slice(7);
          } else if (line.startsWith('data: ')) {
            currentEvent.data = currentEvent.data !== undefined
              ? currentEvent.data + '\n' + line.slice(6)
              : line.slice(6);
          } else if (line.startsWith('id: ')) {
            currentEvent.id = line.slice(4);
          } else if (line.startsWith('retry: ')) {
            currentEvent.retry = parseInt(line.slice(7), 10);
          }
          // Comments (lines starting with :) are ignored
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

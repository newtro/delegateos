/**
 * SSE utilities — writer for ServerResponse and reader for incoming streams.
 */
import type { ServerResponse } from 'node:http';
import type { SSEEvent } from './types.js';
/**
 * Writes SSE frames to an HTTP response.
 */
export declare class SSEWriter {
    private res;
    private closed;
    private keepAliveTimer;
    constructor(res: ServerResponse, keepAliveMs?: number);
    send(event: SSEEvent): void;
    close(): void;
    get isClosed(): boolean;
}
/**
 * Parses SSE events from a readable text stream (e.g. fetch response body).
 */
export declare class SSEReader {
    private stream;
    constructor(stream: ReadableStream<Uint8Array>);
    events(): AsyncGenerator<SSEEvent>;
}

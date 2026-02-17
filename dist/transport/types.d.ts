/**
 * Transport types for HTTP+SSE MCP proxy.
 */
/** Inbound message over HTTP transport */
export interface TransportMessage {
    id: string;
    method: string;
    params: unknown;
    dct?: string;
}
/** Outbound response over HTTP transport */
export interface TransportResponse {
    id: string;
    result?: unknown;
    error?: TransportError;
    stream?: boolean;
}
/** Transport-level error */
export interface TransportError {
    code: number;
    message: string;
    data?: unknown;
}
/** Server configuration */
export interface TransportConfig {
    port: number;
    host: string;
    basePath: string;
    corsOrigins?: string[];
    authRequired: boolean;
}
/** SSE event frame */
export interface SSEEvent {
    event: string;
    data: string;
    id?: string;
    retry?: number;
}

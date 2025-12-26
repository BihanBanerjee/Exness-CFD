/**
 * Redis Stream Utilities
 * Provides functions for publishing to and consuming from Redis Streams
 * Used for request/response communication between HTTP-BACKEND and Liquidation Engine
 */

import Redis from "ioredis";
import type { StreamRequest, StreamResponse } from "@exness/redis-stream-types";
import { serializeForStream } from "@exness/redis-stream-types";



const DEFAULT_TIMEOUT = 5000; // 5 seconds
const BLOCK_MS = 1000; // Block for 1 second when reading from the stream
const MAX_STREAM_LENGTH = 100000; // Event replay safety limit (previously was 10000)

/**
 * Publish a request(a message basically) to a Redis stream.
 * @param client Redis client instance
 * @param streamName Name of the stream to publish to (e.g., "request:stream")
 * @param request The request object to publish
 * @returns The stream entry ID
 */

export async function publishRequest(
    client: Redis,
    streamName: string,
    request: StreamRequest,
): Promise<string> {
    const serialized = serializeForStream(request);

    /**
     * XADD command: Add entry to stream with auto-generated ID (*)
     * streamId is unique identifier string for each entry in Redis stream.
     * Format: <millisecondsTime>-<sequenceNumber>
     * For example: 1703001234567-0 Where:
     * 1703001234567 = Unix timestamp in milliseconds when the entry was added
     * 0 = Sequence number (increments if multiple entries are added in the same millisecond)
     * The "*" tells Redis to auto-generate a unique stream ID using the current timestamp.
     */
    
    const streamId = await client.xadd( 
        streamName,
        "MAXLEN",
        "~",
        MAX_STREAM_LENGTH.toString(),
        "*",
        "data",
        serialized   
    );
    // return streamId!; --> it could hav been a solution. But this is the better one.
     if (!streamId) {
        throw new Error(`Failed to add entry to Redis stream: ${streamName}`);
     }

     return streamId;
}


/**
 * Publish a response to a Redis stream
 * @param client Redis client instance
 * @param streamName Name of the response stream
 * @param response The response object to publish
 * @returns The stream entry ID
 */

export async function publishResponse(
    client: Redis,
    streamName: string,
    response: StreamResponse
): Promise<string> {
    const serialized = serializeForStream(response);

    // Response stream can use tighter limit since responses are ephemeral and deleted after read
    const streamId = await client.xadd(
        streamName,
        "MAXLEN",
        "~",
        "10000", // Response are short-lived (read+delete by HTTP Server)
        "*",
        "data",
        serialized,
        "requestId",
        response.requestId
    );

    if(!streamId) {
        throw new Error(`Failed to add response to Redis stream: ${streamName}`);
    }

    return streamId;
}

/**
 * Publish a response to the callback queue (for subscriber pattern)
 * This is more efficient than publishing to a stream for transient responses
 * 
 * @param client Redis Client instance
 * @param queueName Name of the queue stream
 * @param response The response object to publish
 * @returns The stream entry ID
 */
export async function publishResponseToQueue(
    client: Redis,
    queueName: string,
    response: StreamResponse
): Promise<string> {
    const serialized = serializeForStream(response);

    // Use stream for queue but with tight MAXLEN since messages are deleted after read
    const streamId = await client.xadd(
        queueName, // basically here queue or stream means the same thing.
        "MAXLEN",
        "~",
        "1000", // very tight limit - message deleted immediately after dispatch
        "*",
        "requestId",
        response.requestId,
        "data",
        serialized
    );

    if(!streamId) {
        throw new Error(`Failed to add response to queue: ${queueName}`);
    }

    return streamId;
}


/**
 * Get the latest stream ID (for initializing snapshot tracking)
 */
export async function getLatestStreamId(
    client: Redis,
    streamName: string
): Promise<string> {
    const result = await client.xrevrange(streamName, "+", "-", "COUNT", "1");

    if(result && result.length > 0 && result[0] && result[0][0]) {
        return result[0][0]; // Return the stream ID.
    }

    return "0-0" // No entries yet.
}
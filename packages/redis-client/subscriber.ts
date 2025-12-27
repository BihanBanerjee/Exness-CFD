/**
 * Redis Response Subscriber
 * Efficient single-reader pattern for handling API responses
 * Uses Redis Streams with callback dispatch for high concurrency
 */

import { resolve } from "bun";
import Redis from "ioredis";

export const RESPONSE_QUEUE = "response:queue";

export class RedisSubscriber {
    private client: Redis;
    private callbacks: Record<string, (data: any) => void>;
    private isRunning: boolean = false;

    constructor() {
        const host = process.env.REDIS_HOST || "localhost";
        const port = Number(process.env.REDIS_PORT || 6380);
        this.client = new Redis({ host, port });
        this.callbacks = {};
    }

    /**
     * Start the subscriber loop
     * Should be called once when the server starts
     */

    start () {
        if(this.isRunning) {
            console.warn("[SUBSCRIBER] Already running");
            return;
        }

        this.isRunning = true;

        // Start runLoop in background (don't wait - it's an infinite loop)
        // Catch any startup errors and log them
        this.runLoop().catch((error) => {
            console.error("[SUBSCRIBER] Fatal error in runLoop:", error);
            this.isRunning = false;
        })

        console.log("[SUBSCRIBER] Started");
    }

    /**
     * Main event loop - reads from stream and dispatches to callbacks 
     * 1. Tracks lastId to avoid race conditions
     * 2. Cleans up messages after dispatch (xdel)
     * 3. Blocks indefinitely for efficiency
     */

    private async runLoop() {
        let lastId = "$"; // Start from latest entries

        while(this.isRunning) {
            try {
                // XREAD with infinite blocking for efficiency
                const response = await this.client.xread(
                    "BLOCK",
                    "0", // Block forever until message arrives
                    "STREAMS",
                    RESPONSE_QUEUE,
                    lastId
                );

                if (!response || response.length === 0) {
                    continue;
                }

                const [, messages] = response[0]!;
                if(!messages || messages.length === 0) {
                    continue;
                }

                for (const [id, rawFields] of messages) {
                    lastId = id; // Track position to avoid missing messages

                    const fields = rawFields as string[];
                    const data: Record<string, string> = {};
                    for (let i = 0; i < fields.length; i+= 2){
                        data[fields[i]!] = fields[i + 1]!;
                    }

                    const requestId = data.requestId;
                    console.log(`[SUBSCRIBER] Received response for: ${requestId}`);

                    // Dispatch to registered callback
                    const callback = requestId ? this.callbacks[requestId] : undefined;
                    if (callback) {
                        try {
                            callback(data);
                            delete this.callbacks[requestId!];
                        } catch (error) {
                            console.error(`[SUBSCRIBER] Callback error for ${requestId}`, error);
                        }
                    } else {
                        console.warn(`[SUBSCRIBER] No waiter for requestId: ${requestId}`);
                    }

                    // Delete messages after processing
                    try {
                        await this.client.xdel(RESPONSE_QUEUE, id);
                    } catch (error) {
                        console.error(`[SUBSCRIBER failed to delete message ${id}]`, error);
                    }
                    
                }
            } catch(error) {
                console.error(`[SUBSCRIBER] Error in runLoop:`, error);
                // Wait before retry to avoid tight error loop
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }

    }

    /**
     * Wait for a response with specific requestId
     * Calling this BEFORE publishing the request to avoid race conditions
     * 
     * @param requestId The unique request identifier
     * @param timeout Timeout in milliseconds (default: 5000)
     * @returns Promise that resolves with response data
     */

    waitForMessage<T = any>(requestId: string, timeout: number = 5000): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            console.log(`[SUBSCRIBER] Waiting for requestId: ${requestId}`);

            // Setup timeout
            const timer = setTimeout(() => {
                if (this.callbacks[requestId]) {
                    delete this.callbacks[requestId];
                    reject(new Error(`Timeout waiting for response: ${requestId} (${timeout}ms)`));
                }
            }, timeout);
            
            //Register callback
            this.callbacks[requestId] = (data: any) => {
                clearTimeout(timer);

                // Parse response data
                try {
                    const response = data.data ? JSON.parse(data.data) : data;
                    resolve(response as T);
                } catch(error) {
                    reject(new Error(`Failed to parse response for ${requestId}: ${error}`));
                }
            };// This function won't run yet! It's just stored, waiting for runLoop() to call it later.
        });
    }

    /**
     * Stop the subscriber (graceful shutdown)
     */
    async stop() {
        console.log("[SUBSCRIBER] Stopping...");
        this.isRunning = false;

        // Reject all pending callbacks
        const pendingRequestIds = Object.keys(this.callbacks);
        for (const requestId of pendingRequestIds) {
            const callback = this.callbacks[requestId];
            if (callback) {
                try {
                    callback({ error: "Subscriber shutdown" });
                } catch(error) {

                }
                delete this.callbacks[requestId];
            }
        }

        await this.client.quit();
        console.log("[SUBSCRIBER] Stopped");
        
    }

    /**
     * Get count of pending waiters (for monitoring)
     * @returns Number of pending waiters
     */
    getPendingCount(): number {
        return Object.keys(this.callbacks).length;
    }


}

// Singleton instance for shared use
let subscriberInstance: RedisSubscriber | null = null;
/**
 * Get or create the singleton subscriber instance
 */

export function getSubscriber(): RedisSubscriber {
    if (!subscriberInstance) {
        subscriberInstance = new RedisSubscriber();
        subscriberInstance.start();
    }
    return subscriberInstance;
}
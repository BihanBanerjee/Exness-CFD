/**
 * Liquidation Engine 
 * Stateful service that maintains global state of all users, orders and balances.
 * Communicates with HTTP Server via Redis Streams.
 * Features:
 * - Request/Response pattern for order operations
 * - Real-time price monitoring and automatic liquidation
 * - Periodic snapshots every 15 seconds
 * - Event replay for crash recovery
 */

import redisClient from "@exness/redis-client";
import { StateManager } from "./src/state/StateManager";
import { RequestHandler } from "./src/handlers/RequestHandlers";
import { SnapshotManager } from "./src/persistence/SnapshotManager";
import { PriceMonitor } from "./src/monitoring/PriceMonitor";
import { STREAMS, ENGINE_STATUS_KEY, EngineStatus } from "@exness/redis-stream-types";
import type { StreamRequest, EngineStatusData } from "@exness/redis-stream-types";
import { 
    getLatestStreamId, 
    publishResponse, 
    publishResponseToQueue 
} from "@exness/redis-client/stream";
import { RESPONSE_QUEUE } from "@exness/redis-client/subscriber";
import { prisma } from "@exness/prisma-client";


// -----------------------------Configuration-----------------------------

const SNAPSHOT_INTERVAL_MS = 15000; // 15 seconds

// -----------------------------Global State-----------------------------

let state: StateManager;
let requestHandler: RequestHandler;
let snapshotManager: SnapshotManager;
let priceMonitor: PriceMonitor;
let snapshotTimer: NodeJS.Timeout | null = null;
let currentStreamId = "0-0";


// ----------------------------Helper Functions----------------------------

/**
 * Set engine status in Redis
 */
async function setEngineStatus(status: EngineStatus, message?: string ): Promise<void> {
    const statusData: EngineStatusData = {
        status,
        timestamp: Date.now(),
        message,
    };
    await redisClient.set(ENGINE_STATUS_KEY, JSON.stringify(statusData));
    console.log(`[Engine Status] ${status}${message ? ` - ${message}` : ''}`);
    
}

// ------------------------------Initialization-------------------------------

/**
 * Initialize the engine - load snapshot and replay events
 */

async function initialize (): Promise<void> {
    console.log("==".repeat(60));
    console.log("Liquidation Engine Starting.....");
    console.log("=".repeat(60));

    // Set status to STARTING
    await setEngineStatus(EngineStatus.STARTING, "Initializing components");

    // Initialize components
    state = new StateManager();
    requestHandler = new RequestHandler(state);
    snapshotManager = new SnapshotManager(state);
    priceMonitor = new PriceMonitor(state);    

    // Set up price monitor liquidation callback
    priceMonitor.setLiquidationCallback(async (orderId, reason, pnl) => {
        await priceMonitor.liquidateOrder(orderId, reason, pnl);
    });

    // Load latest snapshot
    console.log("\nLoading latest snapshot...");
    const snapshot = await snapshotManager.loadLatestSnapshot();

    if (snapshot) {
        console.log(`Snapshot loaded: ${snapshot.snapshotId}`);
        console.log(`Last stream ID from snapshot: ${snapshot.lastStreamId}`);

        // Set status to REPLAYING - this will cause API requests to be rejected
        await setEngineStatus(EngineStatus.REPLAYING, "Replaying events since last snapshot");

        // Replay events since snapshot
        console.log("\nReplaying events since snapshot...");
        let replayedCount = 0;
        let priceUpdateCount = 0;

        // Track last known prices (bid/ask) for each symbol during replay
        const lastKnownPrices: Record<string, {bid: number, ask: number}> = {};

        // Manual replay to handle both price updates and requests
        const events = await redisClient.xrange(
        STREAMS.REQUEST,
        `(${snapshot.lastStreamId}`, // Exclusive start
        "+" // End (latest)
        );

        for (const [streamId, fields] of events) {
            const fieldMap: Record<string, string> = {};
            for (let i = 0; i < fields.length; i += 2) {
                const key = fields[i];
                const value = fields[i + 1];
                if (key && value) {
                    fieldMap[key] = value;
                }
            }

            const messageType = fieldMap.type;

            if (messageType === "PRICE_UPDATE") {
                // Track latest price for each symbol during replay
                if (fieldMap.payload) {
                    const payload = JSON.parse(fieldMap.payload);
                    const { symbol, bidPriceInt, askPriceInt } = payload;
                    const bidPrice = Number(BigInt(bidPriceInt)) / 100_000_000;
                    const askPrice = Number(BigInt(askPriceInt)) / 100_000_000;

                    // Store both bid and ask for accurate replay
                    lastKnownPrices[symbol] = {bid: bidPrice, ask: askPrice};
                    
                    // CRITICAL FIX: Update Redis with HISTORICAL price for this point in time
                    // This ensures RequestHandler uses the correct historical price during replay
                    await redisClient.set(
                        `market:${symbol}`,
                        JSON.stringify({
                            bidPriceInt: bidPriceInt.toString(),
                            askPriceInt: askPriceInt.toString(),
                            bidPrice: bidPrice,
                            askPrice: askPrice,
                            timestamp: parseInt(fieldMap.timestamp || '0'),
                            isHistorical: true // Flag to indicate this is replay data.
                        })
                    );

                    priceUpdateCount++;
                }
            } else {
                // Replay order request
                if (fieldMap.requestId && fieldMap.userId && fieldMap.timestamp && fieldMap.payload) {
                    const request: StreamRequest = {
                      requestId: fieldMap.requestId,
                      type: messageType as any,
                      userId: fieldMap.userId,
                      timestamp: parseInt(fieldMap.timestamp),
                      payload: JSON.parse(fieldMap.payload),
                    };
        
                    console.log(`Replaying request ${request.requestId} from ${streamId}`);
                    await requestHandler.handleRequest(request);
                    currentStreamId = streamId;
                    replayedCount++;
                }
            }
        }

        console.log(`Replayed ${replayedCount} order events, tracked ${priceUpdateCount} price updates`);

        // Initialize PriceMonitor with last known prices from replay
        if (Object.keys(lastKnownPrices).length > 0) {
            console.log("\nInitializing market prices from replay:");
            for (const [symbol, prices] of Object.entries(lastKnownPrices)) {
                console.log(`  ${symbol}: Bid $${prices.bid.toFixed(2)} | Ask $${prices.ask.toFixed(2)}`);
                // Update the price monitor with the last known price
                // Cast symbol to token type (BTCUSDT, ETHUSDT, SOLUSDT)
                await priceMonitor.processMarketUpdate(symbol as any, prices.bid, prices.ask);
            }
            console.log("Price monitor initialized - liquidation checks active");
        } else {
            console.log("\nNo price updates found during replay - waiting for first price feed");
        }
    } else {
        console.log("No snapshot found - starting fresh");
        currentStreamId = await getLatestStreamId(redisClient, STREAMS.REQUEST);
    }

    // Display initial state
    state.logState();

    // Set status to READY - HTTP Server can now accept requests
    await setEngineStatus(EngineStatus.READY, "Engine initialized and ready to process requests")

    console.log("\nEngine initialized successfully!");
    console.log("=".repeat(60));
}


// ---------------------------------------- Unified Stream Processing --------------------------------------------
/**
 * Start consuming unified stream (both price updates and their order requests)
 */
async function startUnifiedStreamConsumer(): Promise<void> {
    console.log("\nStarting unified stream consumer....");
    console.log(`Listening on: ${STREAMS.REQUEST}`);
    console.log(`Starting from: ${currentStreamId}`);

    // Start consuming (this runs indefinitely)
    while(true) {
        try{
            const results = (await redisClient.call(
                "XREAD",
                "BLOCK", "5000",
                "COUNT", "10",
                "STREAMS",
                STREAMS.REQUEST,
                currentStreamId
            )) as [string, [string, string[]][]][] | null;

            if (!results || results.length === 0) {
                continue;
            }

            // Process each message
            for (const [_streamName, messages] of results) {
                for (const [streamId, fields] of messages) {
                    try {
                        // Parse the message fields
                        const fieldMap: Record<string, string> = {};
                        for (let i = 0; i < fields.length; i+= 2) {
                            const key = fields[i];
                            const value = fields[i + 1];
                            if (key && value) {
                                fieldMap[key] = value;
                            }
                        }

                        const messageType = fieldMap.type;

                        if (messageType === "PRICE_UPDATE") {
                            // Handle price update
                            if (!fieldMap.payload) {
                                console.error("Missing payload for PRICE_UPDATE");
                                continue;
                            }
                            const payload = JSON.parse(fieldMap.payload);
                            const { symbol, bidPriceInt, askPriceInt, midPriceInt } = payload;

                            // Convert the decimal prices
                            const bidPrice = Number(BigInt(bidPriceInt)) / 100_000_000;
                            const askPrice = Number(BigInt(askPriceInt)) / 100_000_000;
                            const midPrice = Number(BigInt(midPriceInt)) / 100_000_000;

                            // Store latest price in Redis for RequestHandler to use 
                            await redisClient.set(
                                `market:${symbol}`,
                                JSON.stringify({
                                    bidPriceInt: bidPriceInt.toString(),
                                    askPriceInt: askPriceInt.toString(),
                                    midPriceInt: midPriceInt.toString(),
                                    bidPrice: bidPrice,
                                    askPrice: askPrice,
                                    midPrice: midPrice,
                                    timeStamp: Date.now()
                                })
                            );

                            // Process with proper bid/ask spread
                            await priceMonitor.processMarketUpdate(symbol, bidPrice, askPrice);

                            console.log(`[Price Update] ${symbol}: Bid $${bidPrice.toFixed(2)} | Ask $${askPrice.toFixed(2)}`);
                        } else {
                            // Handle order request
                            if (!fieldMap.requestId || !fieldMap.userId || !fieldMap.timestamp || !fieldMap.payload) {
                                console.error("Missing required fields for order request");
                                continue;
                            }
                            const request: StreamRequest = {
                                requestId: fieldMap.requestId,
                                type: messageType as any,
                                userId: fieldMap.userId,
                                timestamp: parseInt(fieldMap.timestamp),
                                payload: JSON.parse(fieldMap.payload),
                            }

                            console.log(
                                `\n[Request] ${request.type} | RequestID: ${request.requestId} | User: ${request.userId}`
                            );

                            // Process the request
                            const response = await requestHandler.handleRequest(request);
                            // Publish responses to BOTH:
                            // 1. Response queue (for HTTP Server - efficient callback pattern)
                            await publishResponseToQueue(redisClient, RESPONSE_QUEUE, response)

                            // 2. Response stream (for db worker - durable persistance)
                            await publishResponse(redisClient, STREAMS.RESPONSE, response);

                            console.log(
                                `[Response] ${response.success ? "SUCCESS" : "ERROR"} | RequestID: ${response.requestId}`
                            );   
                        }

                        // Update current stream ID for next read
                        currentStreamId = streamId;
                    } catch (error) {
                        console.error(`Error processing message ${streamId}: error`);
                    }
                }         
            }
        } catch (error) {
            console.error("Error reading from stream:", error);
            // Wait a bit for before retrying
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
    
}

// ----------------------------------- Snapshot Management ----------------------------------------

/**
 * Start periodic snapshot creation
 */
function startPeriodicSnapshots(): void {
    console.log(`\nStarting periodic snapshots (every ${SNAPSHOT_INTERVAL_MS}ms)`);

    snapshotTimer = snapshotManager.startPeriodicSnapshots(
        () => currentStreamId,
        SNAPSHOT_INTERVAL_MS
    );
}

// ------------------------------------ Lifecycle Management -----------------------------------------------
/**
 * Graceful shutdown
 */
async function shutdown(signal: string): Promise<void> {
    console.log(`\n\n${"=".repeat(60)}`);
    console.log(`Received ${signal} - Shutting down gracefully...`);
    console.log("=".repeat(60));

    // Set status to SHUTDOWN - reject any new requests
    await setEngineStatus(EngineStatus.SHUTDOWN, "Engine shutting down");

    // Stop periodic snapshots
    if(snapshotTimer) {
        snapshotManager.stopPeriodicSnapshots(snapshotTimer);
    }

    // Create final snapshot
    console.log("\nCreating final snapshot.....");
    try {
        await snapshotManager.createSnapshot(currentStreamId);
        console.log("Final snapshot created");
    } catch (error) {
        console.error("Error creating final snapshot:", error);
    }

    // Display final state
    state.logState();

    // Close connections
    console.log("\nClosing connections....");
    await redisClient.quit();
    await prisma.$disconnect();
    
    console.log("Shutdown complete");
    console.log("=".repeat(60));
    process.exit(0);    
}

// -------------------------------------------- Error Handling --------------------------------------------
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", async (error) => {
    console.error("Uncaught exception:", error);
    await shutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", async (reason, promise) => {
    console.error("Unhandled rejection at", promise, "reason:", reason);
    await shutdown("UNHANDLED_REJECTION");
});

// ------------------------------------------- Main ---------------------------------------------------------
async function main(): Promise<void> {
    try {
        // Initialize the engine (load snapshots + replay events)
        await initialize();

        // Start unified stream consumer (handles both prices and requests)
        startUnifiedStreamConsumer();

        // Start periodic snapshots
        startPeriodicSnapshots();

        // Log stats every 60 seconds
        setInterval(() => {
            console.log("\n" + "=".repeat(60));
            state.logState();
            const monitoringStats = priceMonitor.getMonitoringStats();
            console.log("\nMonitoring Stats:");
            console.log(`Open Orders by Asset: `, monitoringStats.byAsset);
            console.log(`Open Orders by Type: `, monitoringStats.byType);
            console.log("=".repeat(60));
        }, 60000);

        console.log("\nEngine is running and ready to process requests!");
        console.log("Press Ctrl+C to shutdown gracefully\n");
    } catch (error) {
        console.error("Fatal error starting engine:", error);
        process.exit(1);
    }
}

// Start the engine
main();
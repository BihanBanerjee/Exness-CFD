import redisClient from "@exness/redis-client";
import WebSocket from "ws";
import { BATCH_UPLOADER_STREAM } from "./config";
import { STREAMS, createPriceUpdate, serializeForStream } from "@exness/redis-stream-types";

const SUPPORTED_PAIRS = ["btcusdt", "solusdt", "ethusdt"];

async function main () {
    const ws = new WebSocket("wss://stream.binance.com:9443/ws"); // creating a web-socket client connection to listen to the streams coming from Binance's WS server.
    
    ws.onopen = () => { // onopen is an event handler(not a method) that gets triggered when the WebSocket connection is successfully established with the Binance WS server.
        console.log("Connected to Binance");
        const subscribeMessage = {
            method: "SUBSCRIBE",
            params: SUPPORTED_PAIRS.map((p) => `${p}@trade`),
            id: 1,
        }
        ws.send(JSON.stringify(subscribeMessage)); // stringifying the subscribeMessage object because WebSocket can only send text or binary data, not JavaScript objects.
    };

    ws.onmessage = async ({ data }) => {
        try {
            const payload = JSON.parse(data.toString())
            if (!payload.p || !payload.T || !payload.s || !payload.q) {
                return;
            }

            const originalPrice = parseFloat(payload.p);
            const quantity = parseFloat(payload.q);

            // Creating spread for house edge(0.1%).
            const SPREAD_PERCENTAGE = 0.001;

            const manipulatedPrice = {
                bid: originalPrice * (1 - SPREAD_PERCENTAGE), // Lower for user sells.
                ask: originalPrice * (1 + SPREAD_PERCENTAGE), // Higher for user buys.
            }

            // Honest price data for database storage(candlestick charts)
            let honestPriceData = {
                price: originalPrice,
                quantity: quantity,
                timestamp: payload.T,
                symbol: payload.s
            };

            // Convert manipulated bid/ask prices to integer format (price * 100,000,000)
            const bidPriceInt = BigInt(Math.round(manipulatedPrice.bid * 100_000_000));
            const askPriceInt = BigInt(Math.round(manipulatedPrice.ask * 100_000_000));

            // Create price update message for liquidation engine with both bid and ask
            const priceUpdateMessage = createPriceUpdate(
                payload.s,
                bidPriceInt, // Real bid price
                askPriceInt, // Real ask price
                payload.T
            );

            // Stream MANIPULATED prices to REQUEST stream for liquidation engine.
            await redisClient.xadd(
                STREAMS.REQUEST,
                "*",
                "type",
                priceUpdateMessage.type,
                "timestamp",
                priceUpdateMessage.timestamp.toString(),
                "payload",
                serializeForStream(priceUpdateMessage.payload)
            );
            console.log(`Streamed price update to ${STREAMS.REQUEST}: ${payload.s}`);

            // Stream HONEST prices for database storage (candlestick charts)
            await redisClient.xadd(
                BATCH_UPLOADER_STREAM,
                "*",
                "data",
                JSON.stringify(honestPriceData)
            );
            console.log(`Added honest prices to Redis stream: ${BATCH_UPLOADER_STREAM}`);
                        
        } catch (error) {
            console.error("Error processing message: ", error);
        }
    };

    ws.onclose = () => {
        console.log("client closed");
    }
}

main();
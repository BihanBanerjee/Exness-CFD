import redisClient from "@exness/redis-client";
import WebSocket from "ws";
import { BATCH_UPLOADER_STREAM } from "./config";
import { STREAMS, createPriceUpdate, serializeForStream } from "@exness/redis-stream-types";

const SUPPORTED_PAIRS = ["btcusdt", "solusdt", "ethusdt"];

async function main () {
    const ws = new WebSocket("wss://stream.binance.com/ws"); // creating a web-socket client connection to listen to the streams coming from Binance's WS server.
    
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
            if (!payload.p || !payload.T || payload.s || payload.q) {
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
            let honesPriceData = {
                price: originalPrice,
                quantity: quantity,
                timestamp: payload.T,
                symbol: payload.s
            };

            // convert manipulated price to integer format (price * 100,000,000)
            // We'll use the mid-price for liquidation engine.
            const midPrice = (manipulatedPrice.bid + manipulatedPrice.ask) / 2;
            const priceInt = BigInt(Math.round(midPrice * 100_000_000));

            // Create price update message for liquidation engine
            const priceUpdateMessage = createPriceUpdate(
                payload.s,
                priceInt,
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

            // Stream HONEST prices for database storage (candleatick charts)
            await redisClient.xadd(
                BATCH_UPLOADER_STREAM,
                "*",
                "data",
                JSON.stringify(honesPriceData)
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
// import type { Asset, OrderType, OrderStatus } from "@exness/prisma-client"

export const STREAMS = {
    REQUEST: "request:stream",
    RESPONSE: "response:stream",
    BATCH_UPLOADER: "batch:uploader:stream",
} as const

// ------------------ Message Types -------------------
export type MessageType = 
|  "PRICE_UPDATE" 
| "REGISTER_USER"
| "PLACE_ORDER"
| "CLOSE_ORDER"
| "GET_BALANCE"
| "GET_ORDER"
| "GET_USER_ORDERS";

// ------------------- Base Message Structures ---------------------------

export interface BaseStreamMessage<T = any> {
    type: MessageType;
    timestamp: number;
    payload: T
}

export interface PriceUpdateMessage extends BaseStreamMessage<PriceUpdatePayload>{
    type: "PRICE_UPDATE"
}

// ------------------------ Message Payloads -------------------------------
export interface PriceUpdatePayload {
    symbol: string; // e.g., "BTCUSDT"
    priceInt: bigint; // Manipulated price as integer (price * 100,000,000)
    timestamp: number // Unix timestamp in ms
}


// ------------------- Utility Functions -------------------------------

/*
Generate a unique request ID
*/
export function generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2,11)}`;
}

/*
Create a price update message
*/

export function createPriceUpdate(
    symbol: string,
    priceInt: bigint,
    timestamp?: number
): PriceUpdateMessage {
    return {
        type: "PRICE_UPDATE",
        timestamp: timestamp || Date.now(),
        payload: {
            symbol,
            priceInt,
            timestamp: timestamp || Date.now(),
        }
    }
}

export function serializeForStream(obj: any): string {
    return JSON.stringify(obj, (key, value) => 
        typeof value === "bigint" ? value.toString() : value
    );
}

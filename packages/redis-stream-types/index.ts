/** 
 * Redis Stream Types Package
 * Defines all message types for coomunication between HTTP-BACKEND and Liquidation Engine
*/


import type { Asset, OrderType, OrderStatus } from "@exness/prisma-client"

// -------------------------- Stream Names --------------------------

export const STREAMS = {
    REQUEST: "request:stream",
    RESPONSE: "response:stream",
    BATCH_UPLOADER: "batch:uploader:stream",
} as const;

// --------------------------- Engine Status ----------------------------

export const ENGINE_STATUS_KEY = "engine:status";

export enum EngineStatus {
    STARTING = "STARTING",
    REPLAYING = "REPLAYING",
    READY = "READY",
    SHUTDOWN = "SHUTDOWN",
}

export interface EngineStatusData {
    status: EngineStatus;
    timestamp: number;
    message?: string;
}


// ------------------ Message Types -------------------

export type MessageType = 
| "PRICE_UPDATE" 
| "REGISTER_USER"
| "PLACE_ORDER"
| "CLOSE_ORDER"
| "GET_BALANCE"
| "GET_ORDER"
| "GET_USER_ORDERS";

// Prevent PRICE_UPDATE from being used as a request type because PRICE_UPDATE is not a request.
export type RequestType = Exclude<MessageType, "PRICE_UPDATE">

// ------------------- Base Message Structures ---------------------------

export interface BaseStreamMessage<T = any> {
    type: MessageType;
    timestamp: number;
    payload: T
}

export interface StreamRequest<T = any> extends BaseStreamMessage<T>{ // StreamRequest is the structure for requests sent FROM the HTTP-Server TO the liquidation engine.
    requestId: string;
    type: RequestType;
    userId: string; 
}

export interface StreamResponse<T = any> {
    requestId: string;
    success: boolean;
    timestamp: number;
    data?: T;
    error?: string;
}


// ----------------------------- Message Payloads -------------------------------
export interface RegisterUserPayload {
    initialBalanceInt: bigint; // Initial dummy balance (e.g., 100000000000 = 1000 USD)
}


export interface PriceUpdateMessage extends BaseStreamMessage<PriceUpdatePayload>{
    type: "PRICE_UPDATE"
}

// ------------------------ Message Payloads -------------------------------
export interface PriceUpdatePayload {
    symbol: string; // e.g., "BTCUSDT"
    bidPriceInt: bigint; // Bid price as integer (price * 100,000,000) - user sells at this price
    askPriceInt: bigint; // Ask price as integer (price * 100,000,000) - user buys at this price
    midPriceInt: bigint; // Mid price as integer (price * 100,000,000) - for reference
    timestamp: number // Unix timestamp in ms
}

// ------------------------- Request Payloads ---------------------------------
export interface SignupUserPayload {
    initialBalanceInt: bigint; // Initial dummy balance (e.g., 100000000000 = 1000 USD)
}

export interface PlaceOrderPayload {
    orderType: OrderType; // LONG or SHORT
    asset: Asset; // BTCUSDT, ETHUSDT, SOLUSDT
    leverage: number; // 1-100
    qty: number; // Quantity or volume to trade
    stopLoss?: number // Optional stop loss price
    takeProfit?: number // Optional take profit price
}

export interface CloseOrderPayload {
    orderId: string;
}

export interface GetBalancePayload {
    // userId is already in the request base
}

export interface GetOrderPayload {
    orderId: string;
}

export interface GetUserOrdersPayload {
    status?: OrderStatus // Optional filter by status
}

// --------------------------- Response Data ------------------------------------

export interface OrderData {
    orderId: string;
    status: OrderStatus;
    orderType: OrderType;
    asset: Asset;
    leverage: number;
    marginInt: bigint;
    executionPriceInt: bigint;
    qtyInt: bigint;
    stopLossInt: bigint;
    takeProfitInt: bigint;
    liquidationPriceInt: bigint; // Calculated liquidation price
    createdAt: Date;
    finalPnLInt: bigint;
    userId: string;
}

export interface BalanceData {
    balanceInt: bigint;
    userId: string;
}

export interface PlaceOrderResponseData {
    order: OrderData;
    balance: BalanceData
}

export interface CloseOrderResponseData {
    order: OrderData;
    balance: BalanceData;
    PnL: string; // Formatted P&L string
}


export interface GetOrderResponseData {
    order: OrderData
}

export interface GetUserOrdersResponseData {
    orders: OrderData[];
    count: number;
}

export interface GetBalanceResponseData {
    balance: BalanceData
}

export interface signupUserResponseData {
    balance: BalanceData
}

// ---------------------------- Snapshot Data Structure ----------------------------

export interface UserState {
    userId: string;
    balanceInt: bigint;
    orders: string[]; // Array of order IDs
}

export interface StateSnapshot {
    snapshotId: string;
    timestamp: number;
    lastStreamId: string; // Last processed Redis Stream ID
    users: Record<string, UserState>; // userdId -> UserState
    orders: Record<string, OrderData>; // orderId -> OrderState
}



// -------------------------- Error Types ----------------------------
export enum ErrorCode {
    INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
    INVALID_LEVERAGE = "INVALID_LEVERAGE",
    INVALID_QUANTITY = "INVALID_QUANTITY",
    INVALID_PRICE = "INVALID_PRICE",
    ORDER_NOT_FOUND = "ORDER_NOT_FOUND",
    ORDER_ALREADY_CLOSED = "ORDER_ALREADY_CLOSED",
    USER_NOT_FOUND = "USER_NOT_FOUND",
    PRICE_DATA_UNAVAILABLE = "PRICE_DATA_UNAVAILABLE",
    INTERNAL_ERROR = "INTERNAL_ERROR",
    REQUEST_TIMEOUT = "REQUEST_TIMEOUT",
    ENGINE_NOT_READY = "ENGINE_NOT_READY",
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
    bidPriceInt: bigint,
    askPriceInt: bigint,
    timestamp?: number
): PriceUpdateMessage {
    // Calculate the mid-price for reference
    const midPriceInt = (bidPriceInt + askPriceInt) / 2n;
    return {
        type: "PRICE_UPDATE",
        timestamp: timestamp || Date.now(),
        payload: {
            symbol,
            bidPriceInt,
            askPriceInt,
            midPriceInt,
            timestamp: timestamp || Date.now(),
        }
    }
}

/**
 * Create a typed request 
 */
export function createRequest<T>(
    type: RequestType,
    userId: string,
    payload: T
): StreamRequest<T> {
    return {
        requestId: generateRequestId(),
        type,
        userId,
        timestamp: Date.now(),
        payload
    }
}

/**
 * Create a success response
 */
export function createSuccessResponse<T>(
    requestId: string,
    data: T
): StreamResponse<T>{
    return {
        requestId,
        success: true,
        timestamp: Date.now(),
        data,
    }
}


/**
 * Create an error response
 */
export function createErrorResponse(
    requestId: string,
    error: string
): StreamResponse {
    return {
        requestId,
        success: false,
        timestamp: Date.now(),
        error,
    };
}



/**
 * Serialize BigInt values for JSON transmission
 */
export function serializeForStream(obj: any): string {
    return JSON.stringify(obj, (key, value) => 
        typeof value === "bigint" ? value.toString() : value
    );
}

/**
 * Deserialize BigInt values from JSON transmission
 */
export function deserializeFromStream (json: string): any {
    return JSON.parse(json, (key, value) => {
        // Convert string representations of bigints back to bigint
        if (
            typeof value === "string" &&
            /^-?\d+n?$/.test(value) && 
            key.toLowerCase().includes("int")
        ) {
            return BigInt(value.replace("n", ""));
        }
        return value;
    })
}




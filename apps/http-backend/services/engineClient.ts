/**
 * Engine Client
 * Stateless client for communicating with the Liquidation Engine via Redis Streams.
 * Implements request-response pattern with timeout handling.
 */

import redisClient from "@exness/redis-client";
import { publishRequest } from "@exness/redis-client/stream";
import { getSubscriber } from "@exness/redis-client/subscriber";
import { 
    createRequest, 
    STREAMS,
    ENGINE_STATUS_KEY,
    EngineStatus, 
    type CloseOrderPayload, 
    type CloseOrderResponseData, 
    type EngineStatusData,
    type GetOrderPayload, 
    type GetOrderResponseData, 
    type GetUserOrdersResponseData, 
    type GetUserOrdersPayload, 
    type PlaceOrderPayload, 
    type PlaceOrderResponseData, 
    type RequestType, 
    type SignupUserPayload, 
    type signupUserResponseData, 
    type StreamResponse, 
    type GetBalanceResponseData,
    type GetBalancePayload,
    ErrorCode
} from "@exness/redis-stream-types";

const DEFAULT_TIMEOUT = 5000 // 5 seconds

/**
 * Engine Client - sends requests to liquidation engine and waits for responses
 */

export class EngineClient {
    private subscriber = getSubscriber();

    /**
     * check if the liquidation engine is ready to accept requests
     * Throws an error if engine is not in READY state
     */

    private async checkEngineStatus(): Promise<void> {
        const statusJson = await redisClient.get(ENGINE_STATUS_KEY)

        if(!statusJson) {
            throw new Error(`${ErrorCode.ENGINE_NOT_READY}: Liquidation engine is not running.
                Please start the engine first.`)
        }

        const statusData: EngineStatusData = JSON.parse(statusJson);

        if (statusData.status !== EngineStatus.READY) {
            const message = statusData.message || `Engine is in ${statusData.status} state`;
            throw new Error(`${ErrorCode.ENGINE_NOT_READY}: ${message}. Please try again later.`);
        }
    }


    /**
     * Send a request to the engine and wait for a response
     * Register listener BEFORE publishing request to avoid race conditions
     * Checks ENGINE STATUS BEFORE sending request to avoid discarding during replay.
     */
    private async sendRequest<TPayload, TResponse>(
        type: RequestType,
        userId: string,
        payload: TPayload,
        timeout: number = DEFAULT_TIMEOUT
    ): Promise<StreamResponse<TResponse>> {
        try {
            // Check if engine is ready to accept requests (will throw if not READY)
            await this.checkEngineStatus();
            
            // Creating typed request
            const request = createRequest(type, userId, payload);
            // Registering listener BEFORE publishing request to avoid race condition
            const responsePromise = this.subscriber.waitForMessage<StreamResponse<TResponse>>(
                request.requestId,
                timeout
            );

            // Publish to request stream (engine will process and respond)
            await publishRequest(redisClient, STREAMS.REQUEST, request)

            // Wait for response from subscriber (efficient callback pattern)
            const response = await responsePromise;
            return response;
        } catch (error: any) {
            // Re-throw engine status errors with clear messaging
            if(error.message?.includes(ErrorCode.ENGINE_NOT_READY)) {
                throw error;
            }
            throw new Error(
                error.message || "Failed to communicate with liquidation engine"
            );
        } 
    }

    /**
     * Register a new user with initial balance
     */
    async registerUser(
        userId: string,
        initialBalanceInt: bigint
    ) : Promise<StreamResponse<signupUserResponseData>> {
        return this.sendRequest<SignupUserPayload, signupUserResponseData>(
            "REGISTER_USER",
            userId,
            { initialBalanceInt }
        );
    }

    /**
     * Place a new order
     */

    async placeOrder (
        userId: string,
        payload: PlaceOrderPayload
    ): Promise<StreamResponse<PlaceOrderResponseData>> {
        return this.sendRequest<PlaceOrderPayload, PlaceOrderResponseData>(
            "PLACE_ORDER",
            userId,
            payload
        )
    }

    /**
     * Close an existing order
     */

    async closeOrder(
        userId: string,
        orderId: string
    ): Promise<StreamResponse<CloseOrderResponseData>> {
        return this.sendRequest<CloseOrderPayload, CloseOrderResponseData>(
            "CLOSE_ORDER",
            userId,
            { orderId }
        );
    }

    /**
     * Get user balance
     */
    async getBalance(
        userId: string
    ): Promise<StreamResponse<GetBalanceResponseData>> {
        return this.sendRequest<GetBalancePayload, GetBalanceResponseData>(
            "GET_BALANCE",
            userId,
            {}
        );
    }


    /**
     * Get a specific order
     */
    async getOrder(
        userId: string, 
        orderId: string
    ) : Promise<StreamResponse<GetOrderResponseData>> {
        return this.sendRequest<GetOrderPayload, GetOrderResponseData>(
            "GET_ORDER",
            userId,
            { orderId }
        );
    }


    /**
     * Get all user orders (optionally filtered by status)
     */
    async getUserOrders(
        userId: string,
        status?: "OPEN" | "CLOSED"
    ): Promise<StreamResponse<GetUserOrdersResponseData>> {
        return this.sendRequest<GetUserOrdersPayload, GetUserOrdersResponseData>(
            "GET_USER_ORDERS",
            userId,
            { status }
        );
    }
}

// Export singleton instance
export const engineClient = new EngineClient();
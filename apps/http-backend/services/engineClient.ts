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
    type RequestType, 
    type SignupUserPayload, 
    type signupUserResponseData, 
    type StreamResponse 
} from "@exness/redis-stream-types";

const DEFAULT_TIMEOUT = 5000 // 5 seconds

/**
 * Engine Client - sends requests to liquidation engine and waits for responses
 */

export class EngineClient {
    private subscriber = getSubscriber();


    /**
     * Send a request to the engine and wait for a response
     * Register listener BEFORE publishing request to avoid race conditions
     */
    private async sendRequest<TPayload, TResponse>(
        type: RequestType,
        userId: string,
        payload: TPayload,
        timeout: number = DEFAULT_TIMEOUT
    ): Promise<StreamResponse<TResponse>> {
        try {
            // Creating type request
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


}

// Export singleton instance
export const engineClient = new EngineClient();
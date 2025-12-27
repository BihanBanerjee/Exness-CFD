/**
 * Request Handler
 * Process all incoming requests from the http-server via Redis streams
 * Updates in-memory state and returns responses
 */

import redisClient from "@exness/redis-client";
import type { StateManager } from "../state/StateManager";
import type Redis from 'ioredis';
import { createErrorResponse, 
    createSuccessResponse, 
    ErrorCode, 
    type CloseOrderPayload, 
    type CloseOrderResponseData, 
    type GetBalancePayload, 
    type GetBalanceResponseData, 
    type GetOrderPayload, 
    type GetOrderResponseData, 
    type GetUserOrdersPayload, 
    type GetUserOrdersResponseData, 
    type PlaceOrderPayload, 
    type PlaceOrderResponseData, 
    type SignupUserPayload, 
    type signupUserResponseData, 
    type StreamRequest, 
    type StreamResponse 
} from "@exness/redis-stream-types";

import { add, formatPrice, subtract, toInteger } from "@exness/price-utils";

import { 
    isValidLeverage, 
    isValidPrice, 
    isValidQuantity 
} from "../utils/validation";

import { 
    calculateCurrentPnL,
    calculateLiquidationPrice, 
    calculateRequiredMargin 
} from "../utils/liquidation";

export class RequestHandler {
    constructor(
        private state: StateManager,
        private priceRedis: Redis = redisClient
    ) {}

    /**
     * Main request router - handles all request types
     */

    async handleRequest(request: StreamRequest): Promise<StreamResponse> {
        try{
            switch(request.type) {
                case "REGISTER_USER":
                    return await this.handleRegisterUser(request);
                
                case "PLACE_ORDER":
                    return await this.handlePlaceOrder(request);

                case "CLOSE_ORDER":
                    return await this.handleCloseOrder(request);
                
                case "GET_BALANCE":
                    return await this.handleGetBalance(request);
                
                case "GET_ORDER":
                    return await this.handleGetOrder(request);

                case "GET_USER_ORDERS":
                    return await this.handleGetUserOrders(request);

                default:
                    return createErrorResponse(
                        request.requestId,
                        `Unknown request type: ${request.type}`
                    );
            }
        } catch(error: any) {
            console.error(`Error handling request ${request.requestId}:`, error);
            return createErrorResponse(
                request.requestId,
                error.message || "Internal error processing request"
            );
        }
    }

    /**
     * Handle REGISTER_USER request
     */

    private async handleRegisterUser(
        request: StreamRequest<SignupUserPayload>
    ): Promise<StreamResponse<signupUserResponseData>> {
        const { userId, payload, requestId } = request;
        const { initialBalanceInt } = payload;

        // Check if user already exists
        const existingUser = this.state.getUser(userId);
        if (existingUser) {
            return createErrorResponse(
                requestId,
                `User ${userId} already registered in liquidation engine`
            );
        }

        // Initialize user with dummy balance
        this.state.setUser(userId, initialBalanceInt);

        console.log(
            `User registered: ${userId} | Initial Balance: ${formatPrice(initialBalanceInt)}`
        );

        return createSuccessResponse<signupUserResponseData>(
            requestId,
            {
                balance: {
                    balanceInt: initialBalanceInt,
                    userId,
                },
            });
    }

    /**
     * Handle PLACE_ORDER request
     */
    private async handlePlaceOrder(
        request: StreamRequest<PlaceOrderPayload>
    ): Promise<StreamResponse<PlaceOrderResponseData>> {
        const { userId, payload, requestId } = request;
        const { orderType, asset, leverage, qty, stopLoss, takeProfit } = payload;

        // Validate leverage
        if(!isValidLeverage(leverage)) {
            return createErrorResponse(
                requestId,
                `${ErrorCode.INVALID_LEVERAGE}: Leverage must be between 1 and 100`
            );
        }

        // Validate quantity
        if (qty <=0) {
            return createErrorResponse(
                requestId,
                `${ErrorCode.INVALID_QUANTITY}: Quantity must be positive`
            );
        }

        // Get current price from Redis
        const currData = await this.priceRedis.get(`market:${asset}`);
        if(!currData) {
            return createErrorResponse(
                requestId,
                `${ErrorCode.PRICE_DATA_UNAVAILABLE}: Price data not available for ${asset}`
            );
        }

        const parsed = JSON.parse(currData);
        const executionPrice = orderType === "LONG" ? parsed.askPrice : parsed.bidPrice;

        // Convert to integers
        const executionPriceInt = toInteger(executionPrice);
        const qtyInt = toInteger(qty);

        // Validate price
        if(!isValidPrice(executionPriceInt)) {
            return createErrorResponse(
                requestId,
                `${ErrorCode.INVALID_PRICE}: Invalid execution price`
            )
        }

        // Validate quantity
        if(!isValidQuantity(qtyInt)) {
            return createErrorResponse(
                requestId,
                `${ErrorCode.INVALID_QUANTITY}: Invalid quantity`
            )
        }

        // One question --> isValidPrice and isValidQuantity coming from price-utils but isValidLeverage is coming from utils/liquidation ? Should we move isValidLeverage to price-utils for consistency?

        // Calculate Volume and Margin
        const volumeInt = qtyInt; // User provides volume directly.
        const marginInt = calculateRequiredMargin(volumeInt, executionPriceInt, leverage );

        // Check sufficient balance 
        if(!this.state.hasSufficientBalance(userId, marginInt)) {
            const userBalance = this.state.getBalance(userId);
            return createErrorResponse(
                requestId,
                `${ErrorCode.INSUFFICIENT_BALANCE}: Required ${formatPrice(marginInt)}, available ${formatPrice(userBalance)}`
            );
        }

        // Calculate liquidation price
        const liquidationPriceInt = calculateLiquidationPrice(
            executionPriceInt,
            leverage,
            orderType,
            90 // 90% margin loss threshold
        );

        // Create order
        const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const order = {
            orderId,
            status: "OPEN" as const,
            orderType,
            asset,
            leverage,
            marginInt,
            executionPriceInt,
            qtyInt: volumeInt,
            stopLossInt: stopLoss ? toInteger(stopLoss) : 0n,
            takeProfitInt: takeProfit ? toInteger(takeProfit) : 0n,
            liquidationPriceInt,
            createdAt: new Date(),
            finalPnLInt: 0n,
            userId
        };

        // Update State: deduct margin and add order
        const currentBalance = this.state.getBalance(userId);
        const newBalance = subtract(currentBalance, marginInt);

        this.state.updateBalance(userId, newBalance);
        this.state.addOrder(order);

        console.log(
            `Order placed: ${orderId} | User: ${userId} | ${orderType} ${asset} | Leverage: ${leverage}x | Margin: ${formatPrice(marginInt)} | Liq Price: ${formatPrice(liquidationPriceInt)}`
        );

        return createSuccessResponse<PlaceOrderResponseData>(
            requestId, {
                order,
                balance: {
                    balanceInt: newBalance,
                    userId
                }
            }
        )
    };


    /**
     * Handle CLOSE_ORDER request
     */
    private async handleCloseOrder(
        request: StreamRequest<CloseOrderPayload> 
    ): Promise<StreamResponse<CloseOrderResponseData>> {
        const { userId, payload, requestId } = request;
        const { orderId } = payload;

        // Get order from state
        const order = this.state.getOrder(orderId);
        if (!order) {
            return createErrorResponse(
                requestId,
                `${ErrorCode.ORDER_NOT_FOUND}: Order ${orderId} not found`
            );
        }

        // Check ownership
        if(order.userId !== userId) {
            return createErrorResponse(
                requestId,
                `${ErrorCode.ORDER_NOT_FOUND}: Order not found or access denied`
            );
        }

        // Check if already closed
        if(order.status === "CLOSED") {
            return createErrorResponse(
                requestId,
                `${ErrorCode.ORDER_ALREADY_CLOSED}: Order already closed`
            )
        }

        // Get current price
        const currData = await this.priceRedis.get(`market:${order.asset}`);
        if(!currData) {
            return createErrorResponse(
                requestId,
                `${ErrorCode.PRICE_DATA_UNAVAILABLE}: Price data not available`
            );
        }

        const parsed = JSON.parse(currData);
        const currentPrice = order.orderType === "LONG" ? parsed.bidPrice : parsed.askPrice;
        // When an user is trying to close a "LONG" order, which means he is going short(selling) (Important) then we(the system) will look for bidPrice.
        // Similarly, when an user is trying to close a "SHORT" order, which means he is going long(buying) then we(the system) will look for askPrice.

        const currentPriceInt = toInteger(currentPrice);

        // Calculate P&L
        const PnLInt = calculateCurrentPnL(
            currentPriceInt,
            order.executionPriceInt,
            order.qtyInt,
            order.orderType
        );

        // Update state: close order and return margin + P&L
        this.state.closeOrder(orderId, PnLInt);

        const currentBalance = this.state.getBalance(userId);
        const newBalance = add(add(currentBalance, order.marginInt), PnLInt);
        this.state.updateBalance(userId, newBalance);

        console.log(
            `Order closed: ${orderId} | User: ${userId} | P&L: ${formatPrice(PnLInt)} | New Balance: ${formatPrice(newBalance)}`
        );

        const updatedOrder = this.state.getOrder(orderId)!;

        return createSuccessResponse<CloseOrderResponseData>(requestId, {
            order: updatedOrder,
            balance: {
                balanceInt: newBalance,
                userId,
            },
            PnL : formatPrice(PnLInt),
        });
    }

    /**
     * Handle GET_BALANCE request
     */
    private async handleGetBalance(
        request: StreamRequest<GetBalancePayload>
    ): Promise<StreamResponse<GetBalanceResponseData>> {
        const { userId, requestId } = request;

        const balanceInt = this.state.getBalance(userId);

        return createSuccessResponse<GetBalanceResponseData>(requestId, {
            balance: {
                balanceInt,
                userId,
            },
        });
    }

    /**
     * Handle GET_ORDER request
     */

    private async handleGetOrder(
        request: StreamRequest<GetOrderPayload>
    ): Promise<StreamResponse<GetOrderResponseData>> {
        const { userId, payload, requestId } = request;
        const { orderId } = payload;

        const order = this.state.getOrder(orderId);

        if(!order) {
            return createErrorResponse(
                requestId,
                `${ErrorCode.ORDER_NOT_FOUND}: Order not found`
            );
        }

        // Check ownership
        if(order.userId !== userId) {
            return createErrorResponse(
                requestId,
                `${ErrorCode.ORDER_NOT_FOUND}: Order not found or access denied`
            );
        }

        return createSuccessResponse<GetOrderResponseData>(requestId, {
            order,
        });
    }

    /**
     * Handle GET_USERS_ORDERS request
     */

    private async handleGetUserOrders(
        request: StreamRequest<GetUserOrdersPayload>
    ): Promise<StreamResponse<GetUserOrdersResponseData>> {
        const { userId, payload, requestId } = request;
        const { status } = payload;

        const orders = this.state.getUserOrders(userId, status);

        return createSuccessResponse<GetUserOrdersResponseData>(requestId, {
            orders,
            count: orders.length,
        });
    }
}



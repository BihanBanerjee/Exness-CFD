import { 
    divide, 
    multiply, 
    PRICE_SCALE, 
    subtract, 
    toInteger 
} from "@exness/price-utils";
import type { OrderType } from "@exness/prisma-client";

// Default liquidation threshold: 90% of margin. 10% is the brokerage.
const DEFAULT_LIQUIDATION_PERCENT = 90;


/**
 * Calculate volume/quantity from margin, leverage and price
 * Formula: volume = (margin * leverage) / price
 * 
 * @param marginInt Margin in integer format (scaled by 10^8)
 * @param leverage Leverage multiplier (1-100)
 * @param priceInt Price in integer format (scaled by 10^8)
 * @returns Volume/quantity in integer format (scaled by 10^8)
 */

export function calculateVolume(
    marginInt: bigint,
    leverage: number,
    priceInt: bigint
): bigint {
    // margin * leverage
    const leverageInt = toInteger(leverage);
    const marginTimesLeverage = multiply(marginInt, leverageInt);

    // (margin * leverage) / price
    return divide(marginTimesLeverage, priceInt);

}


/**
 * Calculate liquidation price for LONG position
 * Formula: P_liq = P_0 * (1 - x / (100 * L))
 * 
 * For LONG positions: Price drops cause liquidation.
 * 
 * @param entryPriceInt Entry price in integer format
 * @param leverage Leverage multiplier (1-100)
 * @param marginLossPercent Margin loss percentage before liquidation (default 90)
 * @returns Liquidation price in integer format
 */

export function calculateLongLiquidationPrice(
    entryPriceInt: bigint,
    leverage: number,
    marginLossPercent: number = DEFAULT_LIQUIDATION_PERCENT
): bigint {
    // Convert to BigInt for calculation
    const leverageBigInt = BigInt(leverage);
    const marginLossPercentBigInt = BigInt(marginLossPercent);

    // Calculate: x / (100 * L)
    // x / (100 * L) = marginLossPercent / (100 * leverage)
    const denominator = 100n * leverageBigInt;
    const fraction = (marginLossPercentBigInt * PRICE_SCALE) / denominator;

    // Calculate 1 - x / (100 * L)
    const multiplier = PRICE_SCALE - fraction;

    // Calculate P_0 * (1 - x / (100 * L))
    return multiply(entryPriceInt, multiplier);
}


/**
 * Calculate liquidation price for SHORT position
 * Formula: P_liq = P_0 * ( 1 + x / (100 * L))
 * 
 * For SHORT positions: Price rises cause liquidation
 * 
 * @param entryPriceInt Entry price in integer format
 * @param leverage Leverage multiplier (1 - 100)
 * @param marginLossPercent Margin loss percentage before liquidation (default 90)
 * @returns Liquidation price in integer format
 */

export function calculateShortLiquidationPrice(
    entryPriceInt: bigint,
    leverage: number,
    marginLossPercent: number = DEFAULT_LIQUIDATION_PERCENT
): bigint {
    // Convert to BigInt for calculation
    const leverageBigInt = BigInt(leverage);
    const marginLossPercentBigInt = BigInt(marginLossPercent);

    // Calculate: x / ( 100 * L )
    const denominator = 100n * leverageBigInt;
    const fraction = (marginLossPercentBigInt * PRICE_SCALE) / denominator;

    // Calculate: 1 + x / ( 100 * L )
    const multiplier = PRICE_SCALE + fraction;

    // Calculate: P_0 * ( 1 + x / (100 * L))
    return multiply(entryPriceInt, multiplier)
}

/**
 * Calculate liquidation price based on position type
 * 
 * @param entryPriceInt Entry Price in integer format
 * @param leverage Leverage multiplier
 * @param orderType Position type (LONG or SHORT)
 * @param marginLossPercent Margin loss percentage (default 90)
 * @returns Liquidation price in integer format
 */

export function calculateLiquidationPrice(
    entryPriceInt: bigint,
    leverage: number,
    orderType: OrderType,
    marginLossPercent: number = DEFAULT_LIQUIDATION_PERCENT
): bigint {
    if(orderType === 'LONG') {
        return calculateLongLiquidationPrice(entryPriceInt, leverage, marginLossPercent);
    } else {
        return calculateShortLiquidationPrice(entryPriceInt, leverage, marginLossPercent);
    }
}

/**
 * Check if a LONG position should be liquidated based on current price
 * LONG liquidates when: currentPrice <= liquidationPrice
 *
 * @param currentPriceInt Current market price
 * @param liquidationPriceInt Calculated liquidation price
 * @returns true if should liquidate
 */
export function shouldLiquidateLong(
    currentPriceInt: bigint,
    liquidationPriceInt: bigint
): boolean {
    return currentPriceInt <= liquidationPriceInt
}


/**
 * Check if a SHORT position should be liquidated based on current price
 * SHORT liquidates when: currentPrice >= liquidationPrice
 * 
 * @param currentPriceInt Current market price
 * @param liquidationPriceInt Calculated liquidation price
 * @returns true if should liquidate
 */

export function shouldLiquidateShort(
    currentPriceInt: bigint,
    liquidationPriceInt: bigint
): boolean {
    return currentPriceInt >= liquidationPriceInt
}

/**
 * Check if a position should be liquidated based on current price
 * 
 * @param currentPriceInt Current market price
 * @param liquidationPriceInt Calculated liquidation price
 * @param orderType Position type (LONG or SHORT)
 * @returns true if should liquidate
 */

export function shouldLiquidate(
    currentPriceInt: bigint,
    liquidationPriceInt: bigint,
    orderType: OrderType
): boolean {
    if(orderType === "LONG") {
        return shouldLiquidateLong(currentPriceInt, liquidationPriceInt);
    } else {
        return shouldLiquidateShort(currentPriceInt, liquidationPriceInt);
    }
}


/**
 * Check if stop loss should trigger
 * Stop loss triggers when losses reach the user-defined threshold
 *
 * @param currentPnLInt Current profit/loss
 * @param stopLossInt User-defined stop loss threshold (negative value)
 * @returns true if stop loss should trigger
 */

export function shouldTriggerStopLoss(
    currentPnLInt: bigint,
    stopLossInt: bigint
): boolean {
    if(stopLossInt === 0n) return false; // No stop loss set

    // Stop loss triggers when losses exceed the threshold
    // currentPnl is negative when in loss
    return currentPnLInt < 0n && (currentPnLInt * -1n) >= stopLossInt;
}

/**
 * Check if take profit should trigger
 * Take profit triggers when profits reach the user-defined threshold
 * 
 * @param currentPnLInt Current profit/loss
 * @param takeProfitInt User-defined take profit threshold (positive value)
 * @returns true if take profit should trigger
 */

export function shouldTriggerTakeProfit(
    currentPnLInt: bigint,
    takeProfitInt: bigint
): boolean {
    if(takeProfitInt === 0n) return false // No take profit set

    // Take profit triggers when profit reach the threshold
    return currentPnLInt > 0n && currentPnLInt >= takeProfitInt;
}

/**
 * Calculate current P&L for a position
 * 
 * @param currentPriceInt Current market price
 * @param entryPriceInt Entry price
 * @param volumeInt Position volume / quantity
 * @param orderType Position type (LONG or SHORT)
 * @returns P&L in integer format (positive = profit, negative = loss)
 */

export function calculateCurrentPnL(
    currentPriceInt: bigint,
    entryPriceInt: bigint,
    volumeInt: bigint,
    orderType: OrderType
): bigint {
    if(orderType === "LONG") {
        // LONG: PnL = (currentPrice - entryPrice) * volume
        const priceDiff = subtract(currentPriceInt, entryPriceInt)
        return multiply(priceDiff, volumeInt);
    } else {
        // SHORT: PnL = (entryPrice - currentPrice) * volume
        const priceDiff = subtract(entryPriceInt, currentPriceInt);
        return multiply(priceDiff, volumeInt);
    }
}


/**
 * Calculate margin required for a position
 * Formula: margin = (volume * price) / leverage
 * 
 * @param volumeInt Position volume
 * @param priceInt Entry price
 * @param leverage Leverage multiplier
 * @returns Required margin in integer format
 */

export function calculateRequiredMargin(
    volumeInt: bigint,
    priceInt: bigint,
    leverage: number
): bigint {
    const positionValue = multiply(volumeInt, priceInt);
    const leverageInt = toInteger(leverage);
    return divide(positionValue, leverageInt);
}


/**
 * Get liquidation reason based on conditions
 * Priority: Margin Call > Stop Loss > Take Profit
 * 
 * @param currentPriceInt Current market price
 * @param liquidationPriceInt Calculated liquidation price
 * @param currentPnLInt Current P&L
 * @param stopLossInt Stop Loss threshold
 * @param takeProfitInt Take profit threshold
 * @param orderType Position type
 * @returns Liquidation reason or null if no liquidation
 */

export function getLiquidationReason(
  currentPriceInt: bigint,
  liquidationPriceInt: bigint,
  currentPnLInt: bigint,
  stopLossInt: bigint,
  takeProfitInt: bigint,
  orderType: OrderType
): "MARGIN_CALL" | "STOP_LOSS" | "TAKE_PROFIT" | null {
  // Priority 1: Margin Call (90% loss)
  if (shouldLiquidate(currentPriceInt, liquidationPriceInt, orderType)) {
    return "MARGIN_CALL";
  }

  // Priority 2: Stop Loss
  if (shouldTriggerStopLoss(currentPnLInt, stopLossInt)) {
    return "STOP_LOSS";
  }

  // Priority 3: Take Profit
  if (shouldTriggerTakeProfit(currentPnLInt, takeProfitInt)) {
    return "TAKE_PROFIT";
  }

  return null;
}

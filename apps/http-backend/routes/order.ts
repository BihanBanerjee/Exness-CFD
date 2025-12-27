import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { closeOrder, getBalance, getOrder, getUserOrders, openOrder } from "../controller/order.controller";

export const orderRouter: Router = Router();

// Order operations
orderRouter.post("/open", authMiddleware, openOrder);
orderRouter.post("/close/:orderId", authMiddleware, closeOrder);
// User queries (specific routes before parameterized routes)
orderRouter.get("/user/orders", authMiddleware, getUserOrders);
orderRouter.get("/user/balance", authMiddleware, getBalance);
orderRouter.get("/:orderId", authMiddleware, getOrder);
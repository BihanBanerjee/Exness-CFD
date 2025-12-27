import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth";
import { orderRouter } from "./routes/order";
import { candleRouter } from "./routes/candles";
import { getSubscriber } from "@exness/redis-client/subscriber";


const app = express();
const port = process.env.API_PORT || 3005;
app.use(cors({
    credentials: true
}));
/*
cors({ credentials: true }) tells the server to:
Accept cookies, authorization headers, and TLS client certificates from cross-origin requests
Send the Access-Control-Allow-Credentials: true header in responses
Allow the browser to send and receive credentials when making requests from a different origin (domain/port)
*/

app.use(express.json());
app.use(cookieParser());

app.use("/candles", candleRouter)
app.use("/api/v1/user", authRouter);
app.use("/api/v1/order", orderRouter);

// Start Redis subscriber for efficient response handling
const subscriber = getSubscriber();
console.log("Redis subscriber started.................................");

const server = app.listen(port, () => {
    console.log(`API server listening on ${port}`);
});


//---------------------------------Graceful Shutdown---------------------------------

async function shutdown(signal: string):Promise<void> {
    console.log(`\n Received ${signal} - Shutting down gracefully...`);

    // Stop accepting new connections
    server.close(() => {
        console.log("HTTP server closed");
    });

    // Stop the Redis subscriber
    try {
        await subscriber.stop();
        console.log("Redis subscriber stopped");
    } catch (error) {
        console.error("Error stopping subscriber:", error);
    }

    console.log("Shutdown complete");
    process.exit(0);
}

// Handle shutdown signals

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

//Handle uncaught errors
process.on("uncaughtException", async (error) => {
    console.error("Uncaught Exception:", error);
    await shutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", async (reason, promise) => {
    console.error("Unhandled rejection at:", promise, "reason:", reason);
    await shutdown("UNHANDLED_REJECTION");
});
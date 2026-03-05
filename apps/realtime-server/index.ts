import redisClient from "@exness/redis-client";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import jwt from "jsonwebtoken";

const PORT = 3006;
const SUPPORTED_ASSETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

// Extend WebSocket to include client metadata
interface ExtendedWebSocket extends WebSocket {
    clientId?: string;
    userId?: string;
    isAlive?: boolean;
    isAuthenticated?: boolean;
}

/**
 * Why clientId and userId both?
 * To support multiple connections per user while maintaining session management. Example scenario:
    User "user123" opens 3 browser tabs:
    Tab 1: clientId = "client-abc-1" → userId = "user123"
    Tab 2: clientId = "client-abc-2" → userId = "user123"
    Tab 3: clientId = "client-abc-3" → userId = "user123"
 */

interface ClientMessage {
    type: string;
    clientId?: string;
    token?: string;
    ticket?: string;
    [key: string]: any;
}

/**
 * Class-based WebSocket server implementation for real-time crypto price broadcasting
 * Subscribes to Redis pub/sub channels and broadcasts updates to connected clients
 * Supports authentication and client ID tracking
 */
class RealtimeWebSocketServer {
    private wss: WebSocketServer;
    private clients: Map<string, ExtendedWebSocket>; // Map<clientId, ws>
    private subscriber: typeof redisClient;
    private port: number;
    private isShuttingDown: boolean;
    private heartbeatInterval?: NodeJS.Timeout;

    constructor(port: number) {
        this.port = port;
        this.wss = new WebSocketServer({port: this.port})
        this.clients = new Map<string, ExtendedWebSocket>();
        this.subscriber = redisClient.duplicate();
        this.isShuttingDown = false;
    }

    /**
     * Initialize the WebSocket server and Redis subscription
     */
    async initialize(): Promise<void> {
        await this.initializeRedisSubscription();
        this.initializeWebSocketServer();
        this.setupHeartbeat();
        this.setupGracefulShutdown();
        this.logServerInfo();
    }

    /**
     * Set up Redis pub/sub subscription for market price updates
     */
    private async initializeRedisSubscription():Promise<void> {
        try {
            // Connect to Redis if not already connected
            if(
                this.subscriber.status !== 'ready' &&
                this.subscriber.status !== 'connecting' &&
                this.subscriber.status !== 'connect'
            ) {
                await this.subscriber.connect();
            }

            // Set up pattern message listener for market updates
            this.subscriber.on('pmessage', this.handleRedisMessage.bind(this));

            // Subscribe to all market channels (market:BTCUSDT, market:ETHUSDT, etc.)
            await this.subscriber.psubscribe('market:*');
            console.log('Subscribed to Redis market channels (market:*)');
        } catch (error) {
            console.error('Failed to connect to Redis:', error);
            throw error;
        }
    }

    /**
     * Handle incoming Redis pub/sub messages
     */
    private handleRedisMessage(_pattern: string, channel: string, message: string | Buffer): void {
        // Convert message to string if it's a Buffer
        const messageStr = message instanceof Buffer ? message.toString() : String(message);
        const channelStr = String(channel);

        // Validate message and channel
        if (!messageStr || !channelStr) {
            console.log('Received empty message or channel');
            return;
        }

        console.log(`Price update from ${channelStr}`);

        // Extract symbol from channel (market: BTCUSDT -> BTCUSDT)
        const symbol = this.extractSymbolFromChannel(channelStr);
        if(!symbol) {
            console.log('Could not extract symbol from channel:', channelStr);
            return;
        }

        // Broadcast to all authenticated clients
        this.broadcastToAllClients(symbol, messageStr);
    }

    /**
     * Extract trading symbol from Redis channel name
     */
    private extractSymbolFromChannel(channel: string): string | null {
        const parts = channel.split(':');
        return parts[1] || null;
    }

    /**
     * Broadcast price update to all connected WebSocket clients
     */
    private broadcastToAllClients(symbol: string, data: string): void {
        const message = JSON.stringify({
            type: 'price_update',
            symbol,
            data: JSON.parse(data)
        });

        console.log(`Broadcasting ${symbol} update to ${this.clients.size} clients`);

        this.clients.forEach((ws) => {
            // Only send to authenticated clients
            if (ws.readyState === WebSocket.OPEN && ws.isAuthenticated) {
                ws.send(message);
            }
        });
    }

    /**
     * Initialize WebSocket server and connection handlers
     */
    private initializeWebSocketServer(): void {
        this.wss.on('connection', this.handleConnection.bind(this));
    }

    /**
     * When Does the 'connection' Event Get Triggered?
     * The 'connection' event on the WebSocket server is triggered when a client successfully completes the WebSocket handshake with the server.
     * Frontend Client                                    Realtime Server (ws://localhost:3001)
        │                                                         │
        │  1. HTTP Upgrade Request                               │
        │  GET ws://localhost:3001 HTTP/1.1                      │
        │  Connection: Upgrade                                   │
        │  Upgrade: websocket                                    │
        ├───────────────────────────────────────────────────────>│
        │                                                         │
        │                              2. Server validates request│
        │                                 and accepts upgrade    │
        │                                                         │
        │  3. HTTP 101 Switching Protocols                       │
        │  Connection: Upgrade                                   │
        │  Upgrade: websocket                                    │
        │<───────────────────────────────────────────────────────┤
        │                                                         │
        │  ✓ WebSocket connection established                   │
        │                                                         │
        │                              4. 'connection' EVENT FIRED│
        │                                 wss.on('connection')    │
        │                                                         │
        │  5. Welcome message sent                               │
        │  {"type": "connection", ...}                           │
        │<───────────────────────────────────────────────────────┤
        │                                                         │
        │  Now bi-directional communication is active            │
        │                                                         │
    */


    /**
     * Handle new WebSocket client connections
     */
    private handleConnection(ws: ExtendedWebSocket, _req: IncomingMessage): void {
        console.log('New frontend client attempting connection');
        // Here, ws is refering to individual websocket clients that are connected to our websocket server and all the events are also pertaining to the individual clients.

        // Mark as alive for heartbeat
        ws.isAlive = true;
        ws.isAuthenticated = false;

        // Setup ping/pong for heartbeat
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        // Set a timeout for authentication (30 seconds)
        const authTimeout = setTimeout(() => {
            if (!ws.isAuthenticated) {
                console.log('Client failed to authenticate within timeout');
                ws.close(4001, 'Authentication timeout');
            }
        }, 30000);

        // Listen for client messages (authentication and identification)
        ws.on('message', (data: Buffer) => {
            try {
                const message: ClientMessage = JSON.parse(data.toString());

                // Handle authentication (supports both JWT token and one-time ticket)
                if (message.type === 'auth' && message.clientId) {
                    if (message.ticket) {
                        clearTimeout(authTimeout);
                        this.handleTicketAuthentication(ws, message.ticket, message.clientId);
                    } else if (message.token) {
                        clearTimeout(authTimeout);
                        this.handleClientAuthentication(ws, message.token, message.clientId);
                    }
                }
            } catch (error) {
                console.error('Error parsing client message:', error);
            }
        });

        ws.on('close', () => {
            clearTimeout(authTimeout);
            this.handleClientDisconnect(ws);
        });

        ws.on('error', (error) => {
            clearTimeout(authTimeout);
            this.handleClientError(ws, error);
        });
    }

    /**
     * Authenticate and identify the client
     */
    private async handleClientAuthentication(
        ws: ExtendedWebSocket,
        token: string,
        clientId: string
    ): Promise<void> {
        try {
            // Verify the token and get user info
            const userId = await this.verifyAuthToken(token);

            if (!userId) {
                console.log('Invalid authentication token');
                ws.close(4002, 'Invalid authentication token');
                return;
            }

            // Check if this client is already connected
            const existingConnection = this.clients.get(clientId);

            if (existingConnection) {
                console.log(`Client ${clientId} reconnecting - closing old connection`);

                // Close the old connection gracefully
                if (existingConnection.readyState === WebSocket.OPEN) {
                    existingConnection.close(1000, 'Replaced by new connection');
                }

                // Remove from map
                this.clients.delete(clientId);
            }

            // Add the new authenticated connection
            ws.clientId = clientId;
            ws.userId = userId;
            ws.isAuthenticated = true;
            this.clients.set(clientId, ws);

            console.log(`Client ${clientId} (User: ${userId}) authenticated. Total clients: ${this.clients.size}`);

            // Send welcome message
            this.sendWelcomeMessage(ws);

        } catch (error) {
            console.error('Authentication error:', error);
            ws.close(4003, 'Authentication failed');
        }
    }

    /**
     * Authenticate client using a one-time Redis ticket
     */
    private async handleTicketAuthentication(
        ws: ExtendedWebSocket,
        ticket: string,
        clientId: string
    ): Promise<void> {
        try {
            const redisKey = `ws:ticket:${ticket}`;
            const userId = await redisClient.get(redisKey);

            if (!userId) {
                console.log('Invalid or expired ticket');
                ws.close(4002, 'Invalid or expired ticket');
                return;
            }

            // Delete the ticket immediately (one-time use)
            await redisClient.del(redisKey);

            // Check if this client is already connected
            const existingConnection = this.clients.get(clientId);
            if (existingConnection) {
                if (existingConnection.readyState === WebSocket.OPEN) {
                    existingConnection.close(1000, 'Replaced by new connection');
                }
                this.clients.delete(clientId);
            }

            // Mark as authenticated
            ws.clientId = clientId;
            ws.userId = userId;
            ws.isAuthenticated = true;
            this.clients.set(clientId, ws);

            console.log(`Client ${clientId} (User: ${userId}) authenticated via ticket. Total clients: ${this.clients.size}`);
            this.sendWelcomeMessage(ws);
        } catch (error) {
            console.error('Ticket authentication error:', error);
            ws.close(4003, 'Authentication failed');
        }
    }

    /**
     * Verify authentication token using JWT
     * Returns userId if valid, null otherwise
     */
    private async verifyAuthToken(token: string): Promise<string | null> {
        try {
            const JWT_SECRET = process.env.JWT_SECRET;

            if (!JWT_SECRET) {
                console.error('JWT_SECRET environment variable is not set');
                return null;
            }

            // Verify JWT token
            const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; [key: string]: any };

            // Extract userId from the decoded token
            if (decoded && decoded.userId) {
                return decoded.userId;
            }

            console.log('Token does not contain userId');
            return null;
        } catch (error) {
            if (error instanceof jwt.JsonWebTokenError) {
                console.error('Invalid JWT token:', error.message);
            } else if (error instanceof jwt.TokenExpiredError) {
                console.error('JWT token expired:', error.message);
            } else {
                console.error('Token verification error:', error);
            }
            return null;
        }
    }

    /**
     * Send welcome message to newly connected client
     */
    private sendWelcomeMessage(ws: ExtendedWebSocket): void {
        const welcomeMessage = JSON.stringify({
            type: 'connection',
            status: 'authenticated',
            message: 'Connected to realtime crypto data',
            assets: SUPPORTED_ASSETS,
            clientId: ws.clientId,
            userId: ws.userId
        });

        ws.send(welcomeMessage);
    }

    /**
     * Handle client disconnection
     */
    private handleClientDisconnect(ws: ExtendedWebSocket): void {
        if (ws.clientId) {
            console.log(`Client ${ws.clientId} disconnected`);
            this.clients.delete(ws.clientId);
        } else {
            console.log('Unidentified client disconnected');
        }
    }

    /**
     * Handle client errors
     */
    private handleClientError(ws: ExtendedWebSocket, error: Error): void {
        console.error('WebSocket error:', error);
        if (ws.clientId) {
            this.clients.delete(ws.clientId);
        }
    }

    /**
     * Setup heartbeat to detect dead connections
     */
    private setupHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            this.clients.forEach((ws, clientId) => {
                if (ws.isAlive === false) {
                    console.log(`Client ${clientId} failed heartbeat - terminating`);
                    this.clients.delete(clientId);
                    return ws.terminate();
                }

                ws.isAlive = false;
                ws.ping();
            });
        }, 30000); // Check every 30 seconds
    }

    /**
     * Set up graceful shutdown handlers
     */
    private setupGracefulShutdown(): void {
        process.on('SIGINT', () => { // Main Trigger - Ctrl+C
            if (this.isShuttingDown) return;
            this.isShuttingDown = true;

            console.log(`\nShutting down realtime server....`);
            this.shutdown();
        })
    }

    /**
     * Gracefully shutdown the server
     */
    private shutdown(): void {
        // Clear heartbeat interval
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.wss.close(() => {
            console.log('WebSocket server closed');
            this.subscriber.quit();
            process.exit(0);
        })
    }

    /**
     * Log server startup information
     */
    private logServerInfo(): void {
        console.log(`Realtime server running on ws://localhost:${this.port}`);
        console.log(`Broadcasting live data for: ${SUPPORTED_ASSETS.join(',')}`);
        console.log(`Frontend can connect to: ws://localhost:${this.port}`);
        console.log(`Authentication required for all connections`);
    }
}

/**
 * Main entry point
 */
async function main() {
    const server = new RealtimeWebSocketServer(PORT);
    await server.initialize();
}

main().catch((error) => {
    console.error('Failed to start realtime server:', error);
    process.exit(1);
})

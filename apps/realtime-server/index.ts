import redisClient from "@exness/redis-client";
import { WebSocketServer, WebSocket } from "ws";

const PORT = 3006;

// Websocket server setup
const wss = new WebSocketServer({port: PORT});

// Track all connected clients
const clients = new Set<WebSocket>();

// Redis subscriber client (separate from main redis client)
// subscriber is a separate, independent Redis client connection that's specifically dedicated to subscribing to Redis Pub/Sub channels.
// The duplicate() method (from the ioredis library) creates a clone of the original Redis client with:
//  - Same configuration (host, port, password, etc.)
//  - Separate connection to Redis
//  - Independent state (can be in different modes)
const subscriber = redisClient.duplicate();

async function initializeRedisSubscription() {
    // Only connect if not already connected
    if (subscriber.status !== 'ready' && subscriber.status !== 'connecting' && subscriber.status !== 'connect') {
        await subscriber.connect();
    }

    // Set up pattern message listener before subscribing. Here's what to DO when a message arrives --> (instruction/recipe)
    subscriber.on('pmessage', (pattern: string, channel: string, message: string | Buffer) => {
        // Convert message to string if it's Buffer.
        const messageStr = message instanceof Buffer ? message.toString() : String(message);
        const channelStr = String(channel);

        // Type guards to ensure we have valid data
        if (!messageStr || !channelStr) {
            console.log('Received empty message or channel');
            return;
        }

        console.log(`Price update from ${channelStr}`);

        // Extract symbol from channel (market: BTCUSDT -> BTCUSDT)
        const symbol = channelStr.split(':')[1];
        if (!symbol) {
            console.log('Could not extract symbol from channel:', channelStr);
            return;
        }

        // Brodcast to ALL connected frontend clients
        brodcastToAllClients(symbol, messageStr);
    });

    // Subscribe to all market channels from price-poller
    // This listens to: market:BTCUSDT, market:ETHUSDT, market:SOLUSDT
    await subscriber.psubscribe('market:*');
    console.log('Subscribed to Redis market channels (market:*)');
}

function brodcastToAllClients(symbol: string, data: string) {
    const message = JSON.stringify({
        type: 'price_update',
        symbol,
        data: JSON.parse(data)
    });

    console.log(`Brodcasting ${symbol} update to ${clients.size} clients`);

    clients.forEach((ws) => {
        if(ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New frontend client connected');
    clients.add(ws);

    // Send welcome message
    ws.send(JSON.stringify({
        type: 'connection',
        message: 'Connected to realtime crypto data',
        assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
    }));

    // Handle client disconnect
    ws.on('close', () => {
        console.log('Frontend client disconnected');
        clients.delete(ws);
    })

    // Handle connection errors
    ws.on('error', (error) => {
        console.error('Websocket error:', error);
        clients.delete(ws);
    });
});

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

  * 1. Client Initiates Connection From your frontend (browser/React app):
     // Frontend code (e.g., in your React app)
        const ws = new WebSocket('ws://localhost:3001');

        ws.onopen = () => {
            console.log('Connected to server!');
        };
    2. HTTP Upgrade Handshake The browser sends an HTTP request asking to "upgrade" to WebSocket protocol:
        GET / HTTP/1.1
        Host: localhost:3001
        Upgrade: websocket
        Connection: Upgrade
        Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
        Sec-WebSocket-Version: 13
    3. Server Accepts and Upgrades Your WebSocket server (apps/realtime-server/index.ts:7) responds:
        HTTP/1.1 101 Switching Protocols
        Upgrade: websocket
        Connection: Upgrade
        Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
    4. 'connection' Event Fires Now the wss.on('connection', ...) callback is triggered:
        // apps/realtime-server/index.ts:70
        wss.on('connection', (ws) => {
            // THIS CODE RUNS NOW
            console.log('New frontend client connected');  // ← Logged to server console
            clients.add(ws);  // ← Add this client to the Set
            
            // Send immediate welcome message
            ws.send(JSON.stringify({
            type: 'connection',
            message: 'Connected to realtime crypto data',
            assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
            }));
        });
    5. Client Receives Welcome Message On the frontend:
        ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log(data);  
        // { type: 'connection', message: 'Connected to realtime crypto data', ... }
        };
    
    6. Inner Event Handlers (Nested .on())
        wss.on('connection', (ws) => {
        // Runs ONCE when client connects
        
        ws.on('close', () => {
            // Runs when THIS specific client disconnects
            console.log('Frontend client disconnected');
            clients.delete(ws);
        });
        
        ws.on('error', (error) => {
            // Runs when THIS specific client has an error
            console.error('WebSocket error:', error);
            clients.delete(ws);
        });
    });
    Key Point: The inner event handlers (ws.on('close'), ws.on('error')) are registered per client and only fire for that specific client.
 */


async function main() {
    await initializeRedisSubscription();
    console.log(`Realtime server running on ws://localhost:${PORT}`);
    console.log(`Broadcasting live data for: BTCUSDT, ETHUSDT, SOLUSDT`);
    console.log(`Frontend can connect to: ws://localhost:${PORT}`);
    
}

// Handle graceful shutdown (only registers once)
let isShuttingDown = false;
process.on('SIGINT', () => {
    if(isShuttingDown) return;
    isShuttingDown = true;

    console.log('\nShutting down realtime server...');
    wss.close(() => {
        console.log('Websocket server closed');
        subscriber.quit();
        process.exit(0);
    });
});

main().catch((error) => {
    console.error('Failed to start realtime server:', error);
    process.exit(1);
});
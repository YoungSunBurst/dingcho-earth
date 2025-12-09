/**
 * Multiplayer WebSocket Server for Dingcho Earth
 *
 * Manages:
 * - Player connections with unique IDs and colors
 * - Player positions (latitude, longitude, facingAngle)
 * - Paint data synchronization across all clients
 */

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3001;

// Create HTTP server
const server = http.createServer((req, res) => {
    // CORS headers for health check
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', players: players.size }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Player storage
const players = new Map();

// Paint data storage - Map of "x,y" -> { color, playerId }
const paintData = new Map();

// Generate random color for new player
function generateRandomColor() {
    const hue = Math.random() * 360;
    const saturation = 70 + Math.random() * 30; // 70-100%
    const lightness = 50 + Math.random() * 20;  // 50-70%
    return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
}

// Generate unique player ID
function generatePlayerId() {
    return 'player_' + Math.random().toString(36).substr(2, 9);
}

// Broadcast message to all clients except sender
function broadcast(message, excludeId = null) {
    const data = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            const clientPlayer = Array.from(players.entries()).find(([id, p]) => p.ws === client);
            if (!clientPlayer || clientPlayer[0] !== excludeId) {
                client.send(data);
            }
        }
    });
}

// Broadcast to all clients including sender
function broadcastAll(message) {
    const data = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// Handle new connection
wss.on('connection', (ws) => {
    const playerId = generatePlayerId();
    const playerColor = generateRandomColor();

    // Default spawn position (Seoul, Korea area)
    const player = {
        id: playerId,
        color: playerColor,
        latitude: 37 + (Math.random() - 0.5) * 5,
        longitude: 127 + (Math.random() - 0.5) * 5,
        facingAngle: Math.random() * Math.PI * 2,
        isWalking: false,
        isRunning: false,
        isJumping: false,
        isDrowning: false,
        ws: ws
    };

    players.set(playerId, player);

    console.log(`Player connected: ${playerId} (color: ${playerColor})`);
    console.log(`Total players: ${players.size}`);

    // Send welcome message with player info and current game state
    const welcomeMessage = {
        type: 'welcome',
        playerId: playerId,
        color: playerColor,
        position: {
            latitude: player.latitude,
            longitude: player.longitude,
            facingAngle: player.facingAngle
        },
        // Send all other players
        players: Array.from(players.entries())
            .filter(([id]) => id !== playerId)
            .map(([id, p]) => ({
                id: id,
                color: p.color,
                latitude: p.latitude,
                longitude: p.longitude,
                facingAngle: p.facingAngle,
                isWalking: p.isWalking,
                isRunning: p.isRunning,
                isJumping: p.isJumping,
                isDrowning: p.isDrowning
            })),
        // Send current paint data
        paintData: Array.from(paintData.entries()).map(([key, value]) => ({
            key: key,
            color: value.color,
            playerId: value.playerId
        }))
    };

    ws.send(JSON.stringify(welcomeMessage));

    // Notify other players about new player
    broadcast({
        type: 'playerJoined',
        player: {
            id: playerId,
            color: playerColor,
            latitude: player.latitude,
            longitude: player.longitude,
            facingAngle: player.facingAngle,
            isWalking: false,
            isRunning: false,
            isJumping: false,
            isDrowning: false
        }
    }, playerId);

    // Handle messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);

            switch (message.type) {
                case 'position':
                    // Update player position
                    if (players.has(playerId)) {
                        const p = players.get(playerId);
                        p.latitude = message.latitude;
                        p.longitude = message.longitude;
                        p.facingAngle = message.facingAngle;
                        p.isWalking = message.isWalking || false;
                        p.isRunning = message.isRunning || false;
                        p.isJumping = message.isJumping || false;
                        p.isDrowning = message.isDrowning || false;

                        // Broadcast position to other players
                        broadcast({
                            type: 'playerMoved',
                            playerId: playerId,
                            latitude: p.latitude,
                            longitude: p.longitude,
                            facingAngle: p.facingAngle,
                            isWalking: p.isWalking,
                            isRunning: p.isRunning,
                            isJumping: p.isJumping,
                            isDrowning: p.isDrowning
                        }, playerId);
                    }
                    break;

                case 'paint':
                    // Handle paint data
                    const paintKey = `${message.x},${message.y}`;
                    const player = players.get(playerId);

                    if (player) {
                        // Store paint data
                        paintData.set(paintKey, {
                            color: player.color,
                            playerId: playerId
                        });

                        // Broadcast paint to all clients (including sender for confirmation)
                        broadcastAll({
                            type: 'painted',
                            x: message.x,
                            y: message.y,
                            color: player.color,
                            playerId: playerId
                        });
                    }
                    break;

                case 'paintBatch':
                    // Handle batch paint data (multiple pixels at once)
                    const batchPlayer = players.get(playerId);

                    if (batchPlayer && Array.isArray(message.pixels)) {
                        const paintedPixels = [];

                        message.pixels.forEach(pixel => {
                            const key = `${pixel.x},${pixel.y}`;
                            paintData.set(key, {
                                color: batchPlayer.color,
                                playerId: playerId
                            });
                            paintedPixels.push({ x: pixel.x, y: pixel.y });
                        });

                        // Broadcast batch paint to all clients
                        broadcastAll({
                            type: 'paintedBatch',
                            pixels: paintedPixels,
                            color: batchPlayer.color,
                            playerId: playerId
                        });
                    }
                    break;

                case 'ping':
                    // Respond to ping with pong
                    ws.send(JSON.stringify({ type: 'pong', timestamp: message.timestamp }));
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    // Handle disconnection
    ws.on('close', () => {
        console.log(`Player disconnected: ${playerId}`);
        players.delete(playerId);
        console.log(`Total players: ${players.size}`);

        // Notify other players
        broadcast({
            type: 'playerLeft',
            playerId: playerId
        });
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error(`WebSocket error for ${playerId}:`, error);
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`Dingcho Earth Multiplayer Server`);
    console.log(`=================================`);
    console.log(`WebSocket server running on ws://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`=================================`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down server...');
    wss.clients.forEach(client => {
        client.close();
    });
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

/**
 * Multiplayer WebSocket Server for Dingcho Earth
 * COMPETITIVE MODE - Players compete for territory!
 *
 * Manages:
 * - Player connections with unique IDs and colors
 * - Player positions (latitude, longitude, facingAngle)
 * - Paint data with territory ownership tracking
 * - Leaderboard (ranking by painted pixel count)
 */

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3001;

// Create HTTP server
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            players: players.size,
            totalPaintedPixels: paintData.size
        }));
    } else if (req.url === '/leaderboard') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getLeaderboard()));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Player storage - includes pixelCount for ranking
const players = new Map();

// Paint data storage - Map of "x,y" -> { color, playerId }
const paintData = new Map();

// Player pixel counts - Map of playerId -> count
const playerPixelCounts = new Map();

// Generate random color for new player
function generateRandomColor() {
    const hue = Math.random() * 360;
    const saturation = 70 + Math.random() * 30;
    const lightness = 50 + Math.random() * 20;
    return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
}

// Generate unique player ID
function generatePlayerId() {
    return 'player_' + Math.random().toString(36).substr(2, 9);
}

// Get leaderboard sorted by pixel count
function getLeaderboard() {
    const leaderboard = [];

    players.forEach((player, playerId) => {
        leaderboard.push({
            playerId: playerId,
            color: player.color,
            pixelCount: playerPixelCounts.get(playerId) || 0
        });
    });

    // Sort by pixel count descending
    leaderboard.sort((a, b) => b.pixelCount - a.pixelCount);

    return leaderboard;
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

// Broadcast leaderboard to all clients
function broadcastLeaderboard() {
    broadcastAll({
        type: 'leaderboard',
        rankings: getLeaderboard()
    });
}

// Paint a pixel and handle territory changes
function paintPixel(x, y, playerId) {
    const key = `${x},${y}`;
    const player = players.get(playerId);
    if (!player) return null;

    const existing = paintData.get(key);
    let previousOwner = null;

    // If pixel was owned by another player, decrease their count
    if (existing && existing.playerId !== playerId) {
        previousOwner = existing.playerId;
        const prevCount = playerPixelCounts.get(previousOwner) || 0;
        if (prevCount > 0) {
            playerPixelCounts.set(previousOwner, prevCount - 1);
        }
    }

    // Only increase count if this is a new pixel for this player
    if (!existing || existing.playerId !== playerId) {
        const currentCount = playerPixelCounts.get(playerId) || 0;
        playerPixelCounts.set(playerId, currentCount + 1);
    }

    // Update paint data
    paintData.set(key, {
        color: player.color,
        playerId: playerId
    });

    return { previousOwner, color: player.color };
}

// Handle new connection
wss.on('connection', (ws) => {
    const playerId = generatePlayerId();
    const playerColor = generateRandomColor();

    // Default spawn position (Seoul, Korea area with randomness)
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
    playerPixelCounts.set(playerId, 0);

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
        paintData: Array.from(paintData.entries()).map(([key, value]) => ({
            key: key,
            color: value.color,
            playerId: value.playerId
        })),
        leaderboard: getLeaderboard()
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

    // Broadcast updated leaderboard
    broadcastLeaderboard();

    // Handle messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);

            switch (message.type) {
                case 'position':
                    if (players.has(playerId)) {
                        const p = players.get(playerId);
                        p.latitude = message.latitude;
                        p.longitude = message.longitude;
                        p.facingAngle = message.facingAngle;
                        p.isWalking = message.isWalking || false;
                        p.isRunning = message.isRunning || false;
                        p.isJumping = message.isJumping || false;
                        p.isDrowning = message.isDrowning || false;

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
                    const result = paintPixel(message.x, message.y, playerId);
                    if (result) {
                        broadcastAll({
                            type: 'painted',
                            x: message.x,
                            y: message.y,
                            color: result.color,
                            playerId: playerId,
                            previousOwner: result.previousOwner
                        });

                        // Broadcast updated leaderboard if territory changed
                        if (result.previousOwner) {
                            broadcastLeaderboard();
                        }
                    }
                    break;

                case 'paintBatch':
                    const batchPlayer = players.get(playerId);
                    if (batchPlayer && Array.isArray(message.pixels)) {
                        const paintedPixels = [];
                        let territoryChanged = false;

                        message.pixels.forEach(pixel => {
                            const result = paintPixel(pixel.x, pixel.y, playerId);
                            if (result) {
                                paintedPixels.push({
                                    x: pixel.x,
                                    y: pixel.y,
                                    previousOwner: result.previousOwner
                                });
                                if (result.previousOwner) {
                                    territoryChanged = true;
                                }
                            }
                        });

                        if (paintedPixels.length > 0) {
                            broadcastAll({
                                type: 'paintedBatch',
                                pixels: paintedPixels,
                                color: batchPlayer.color,
                                playerId: playerId
                            });

                            // Always broadcast leaderboard after batch paint
                            broadcastLeaderboard();
                        }
                    }
                    break;

                case 'ping':
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

        // Note: We keep the player's painted pixels even after disconnect
        // They just won't appear in the leaderboard anymore

        players.delete(playerId);
        playerPixelCounts.delete(playerId);

        console.log(`Total players: ${players.size}`);

        broadcast({
            type: 'playerLeft',
            playerId: playerId
        });

        // Broadcast updated leaderboard
        broadcastLeaderboard();
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for ${playerId}:`, error);
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`Dingcho Earth - COMPETITIVE MODE`);
    console.log(`=================================`);
    console.log(`WebSocket: ws://localhost:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/health`);
    console.log(`Leaderboard: http://localhost:${PORT}/leaderboard`);
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

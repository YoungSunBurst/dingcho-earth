/**
 * Multiplayer WebSocket Server for Dingcho Earth
 * COMPETITIVE MODE - Players compete for territory!
 *
 * Manages:
 * - Player connections with unique IDs and colors
 * - Player positions (latitude, longitude, facingAngle)
 * - Paint data with territory ownership tracking
 * - Leaderboard (ranking by painted pixel count)
 * - Game room system (host, timer, names)
 */

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 9005;

// Create HTTP server
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            players: players.size,
            totalPaintedPixels: paintData.size,
            gameState: gameState,
            hostId: hostId
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

// === GAME ROOM SYSTEM ===
let hostId = null;  // 방장 ID
let gameState = 'waiting';  // 'waiting', 'playing'
let gameDuration = 0;  // 게임 시간 (ms)
let gameTimer = null;  // 게임 타이머
let gameStartTime = null;  // 게임 시작 시간
let gameEndTime = null;  // 게임 종료 시간

// 구별 가능한 색상 팔레트 (최대 20명)
const COLOR_PALETTE = [
    'hsl(0, 85%, 60%)',     // 빨강
    'hsl(210, 85%, 55%)',   // 파랑
    'hsl(120, 70%, 45%)',   // 초록
    'hsl(45, 95%, 55%)',    // 노랑/주황
    'hsl(280, 75%, 60%)',   // 보라
    'hsl(180, 70%, 50%)',   // 청록
    'hsl(330, 80%, 60%)',   // 분홍
    'hsl(30, 90%, 55%)',    // 주황
    'hsl(60, 80%, 50%)',    // 라임
    'hsl(195, 80%, 50%)',   // 하늘색
    'hsl(300, 70%, 55%)',   // 마젠타
    'hsl(150, 70%, 45%)',   // 민트
    'hsl(15, 85%, 55%)',    // 코랄
    'hsl(240, 70%, 60%)',   // 인디고
    'hsl(90, 65%, 50%)',    // 연두
    'hsl(345, 75%, 55%)',   // 로즈
    'hsl(165, 75%, 45%)',   // 틸
    'hsl(255, 65%, 60%)',   // 라벤더
    'hsl(75, 75%, 50%)',    // 올리브
    'hsl(200, 80%, 55%)'    // 스틸블루
];

// 사용 중인 색상 인덱스 추적
const usedColorIndices = new Set();

// 사용되지 않은 색상 할당
function assignColor() {
    // 사용되지 않은 색상 찾기
    for (let i = 0; i < COLOR_PALETTE.length; i++) {
        if (!usedColorIndices.has(i)) {
            usedColorIndices.add(i);
            return { color: COLOR_PALETTE[i], colorIndex: i };
        }
    }
    // 모든 색상이 사용 중이면 랜덤 색상 생성 (드문 경우)
    const hue = Math.random() * 360;
    return { color: `hsl(${Math.round(hue)}, 80%, 55%)`, colorIndex: -1 };
}

// 색상 반환 (플레이어 퇴장 시)
function releaseColor(colorIndex) {
    if (colorIndex >= 0) {
        usedColorIndices.delete(colorIndex);
    }
}

// Generate unique player ID
function generatePlayerId() {
    return 'player_' + Math.random().toString(36).substr(2, 9);
}

// Get leaderboard sorted by pixel count
function getLeaderboard() {
    const leaderboard = [];

    players.forEach((player, playerId) => {
        if (player.name) {  // 이름이 설정된 플레이어만
            leaderboard.push({
                playerId: playerId,
                name: player.name,
                color: player.color,
                pixelCount: playerPixelCounts.get(playerId) || 0
            });
        }
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

// 방장 변경 (랜덤 선택)
function assignNewHost() {
    const playerIds = Array.from(players.keys());
    if (playerIds.length === 0) {
        hostId = null;
        return null;
    }

    const randomIndex = Math.floor(Math.random() * playerIds.length);
    hostId = playerIds[randomIndex];

    console.log(`New host assigned: ${hostId}`);

    // 모든 클라이언트에게 새 방장 알림
    broadcastAll({
        type: 'hostChanged',
        hostId: hostId
    });

    return hostId;
}

// 게임 시작
function startGame(duration) {
    if (gameState === 'playing') return;

    // 게임 시작 시 페인트 데이터 초기화
    paintData.clear();
    playerPixelCounts.forEach((_, playerId) => {
        playerPixelCounts.set(playerId, 0);
    });

    gameState = 'playing';
    gameDuration = duration;
    gameStartTime = Date.now();
    gameEndTime = gameStartTime + duration;

    console.log(`Game started! Duration: ${duration / 1000} seconds`);

    // 모든 클라이언트에게 게임 시작 알림
    broadcastAll({
        type: 'gameStarted',
        duration: duration,
        startTime: gameStartTime,
        endTime: gameEndTime
    });

    // 게임 타이머 설정
    gameTimer = setTimeout(() => {
        endGame();
    }, duration);

    // 매초 남은 시간 브로드캐스트
    const timerInterval = setInterval(() => {
        if (gameState !== 'playing') {
            clearInterval(timerInterval);
            return;
        }

        const remaining = Math.max(0, gameEndTime - Date.now());
        broadcastAll({
            type: 'timeUpdate',
            remaining: remaining
        });

        if (remaining <= 0) {
            clearInterval(timerInterval);
        }
    }, 1000);
}

// 게임 종료
function endGame() {
    if (gameState !== 'playing') return;

    gameState = 'waiting';

    if (gameTimer) {
        clearTimeout(gameTimer);
        gameTimer = null;
    }

    // 최종 순위 계산
    const finalRankings = getLeaderboard();

    console.log('Game ended! Final rankings:', finalRankings);

    // 1등이 다음 방장이 됨 (1등이 있고 아직 연결되어 있는 경우)
    if (finalRankings.length > 0 && players.has(finalRankings[0].playerId)) {
        const winnerId = finalRankings[0].playerId;
        if (hostId !== winnerId) {
            hostId = winnerId;
            console.log(`New host (winner): ${hostId}`);

            // 모든 클라이언트에게 새 방장 알림
            broadcastAll({
                type: 'hostChanged',
                hostId: hostId
            });
        }
    }

    // 모든 클라이언트에게 게임 종료 및 결과 알림
    broadcastAll({
        type: 'gameEnded',
        rankings: finalRankings
    });
}

// 게임 초기화
function resetGame() {
    // 페인트 데이터 초기화
    paintData.clear();
    playerPixelCounts.forEach((_, playerId) => {
        playerPixelCounts.set(playerId, 0);
    });

    // 새 방장 랜덤 선정
    assignNewHost();

    console.log('Game reset! New host:', hostId);

    // 모든 클라이언트에게 리셋 알림
    broadcastAll({
        type: 'gameReset',
        hostId: hostId
    });

    // 리더보드 업데이트
    broadcastLeaderboard();
}

// Paint a pixel and handle territory changes
function paintPixel(x, y, playerId) {
    // 게임 중이 아니면 칠하기 불가
    if (gameState !== 'playing') return null;

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
    const { color: playerColor, colorIndex } = assignColor();

    // Default spawn position (Seoul, Korea area with randomness)
    const player = {
        id: playerId,
        name: null,  // 이름은 나중에 설정
        color: playerColor,
        colorIndex: colorIndex,
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

    // 첫 번째 플레이어는 방장
    const isHost = players.size === 1;
    if (isHost) {
        hostId = playerId;
    }

    console.log(`Player connected: ${playerId} (color: ${playerColor}, isHost: ${isHost})`);
    console.log(`Total players: ${players.size}`);

    // Send welcome message with player info and current game state
    const welcomeMessage = {
        type: 'welcome',
        playerId: playerId,
        color: playerColor,
        isHost: playerId === hostId,
        hostId: hostId,
        gameState: gameState,
        gameDuration: gameDuration,
        gameEndTime: gameEndTime,
        position: {
            latitude: player.latitude,
            longitude: player.longitude,
            facingAngle: player.facingAngle
        },
        players: Array.from(players.entries())
            .filter(([id]) => id !== playerId)
            .map(([id, p]) => ({
                id: id,
                name: p.name,
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

    // Notify other players about new player (이름 설정 전이므로 알리지 않음)
    // playerJoined는 setName 후에 전송됨

    // Handle messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);

            switch (message.type) {
                case 'setName':
                    // 플레이어 이름 설정
                    const targetPlayer = players.get(playerId);
                    if (targetPlayer) {
                        targetPlayer.name = message.name;
                        console.log(`Player ${playerId} set name: ${message.name}`);

                        // 다른 플레이어들에게 새 플레이어 알림
                        broadcast({
                            type: 'playerJoined',
                            player: {
                                id: playerId,
                                name: targetPlayer.name,
                                color: targetPlayer.color,
                                latitude: targetPlayer.latitude,
                                longitude: targetPlayer.longitude,
                                facingAngle: targetPlayer.facingAngle,
                                isWalking: false,
                                isRunning: false,
                                isJumping: false,
                                isDrowning: false
                            }
                        }, playerId);

                        // 리더보드 업데이트
                        broadcastLeaderboard();
                    }
                    break;

                case 'startGame':
                    // 방장만 게임 시작 가능
                    if (playerId === hostId && gameState === 'waiting') {
                        const duration = message.duration || 60000; // 기본 1분
                        startGame(duration);
                    }
                    break;

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

                        // position과 paint를 통합한 메시지 생성
                        const moveMessage = {
                            type: 'playerMoved',
                            playerId: playerId,
                            latitude: p.latitude,
                            longitude: p.longitude,
                            facingAngle: p.facingAngle,
                            isWalking: p.isWalking,
                            isRunning: p.isRunning,
                            isJumping: p.isJumping,
                            isDrowning: p.isDrowning
                        };

                        // paint 데이터가 있으면 함께 처리
                        if (message.pixels && Array.isArray(message.pixels) && message.pixels.length > 0) {
                            const paintedPixels = [];
                            let territoryChanged = false;

                            message.pixels.forEach(pixel => {
                                const result = paintPixel(pixel.x, pixel.y, playerId);
                                if (result) {
                                    paintedPixels.push({ x: pixel.x, y: pixel.y });
                                    if (result.previousOwner) {
                                        territoryChanged = true;
                                    }
                                }
                            });

                            if (paintedPixels.length > 0) {
                                moveMessage.pixels = paintedPixels;
                                moveMessage.color = p.color;

                                // 영역 변경 시 리더보드 업데이트
                                if (territoryChanged) {
                                    broadcastLeaderboard();
                                }
                            }
                        }

                        broadcast(moveMessage, playerId);
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

                case 'fillArea':
                    // 게임 중이 아니면 채우기 불가
                    if (gameState !== 'playing') break;

                    // Handle territory fill (closed area)
                    const fillPlayer = players.get(playerId);
                    if (fillPlayer && Array.isArray(message.pixels)) {
                        const filledPixels = [];

                        message.pixels.forEach(pixel => {
                            const key = `${pixel.x},${pixel.y}`;
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
                                color: fillPlayer.color,
                                playerId: playerId
                            });

                            filledPixels.push({ x: pixel.x, y: pixel.y });
                        });

                        if (filledPixels.length > 0) {
                            console.log(`Player ${playerId} filled ${filledPixels.length} pixels`);

                            // Broadcast fill to all clients
                            broadcastAll({
                                type: 'areaFilled',
                                pixels: filledPixels,
                                color: fillPlayer.color,
                                playerId: playerId
                            });

                            // Update leaderboard
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

        const disconnectedPlayer = players.get(playerId);

        // 색상 반환
        if (disconnectedPlayer) {
            releaseColor(disconnectedPlayer.colorIndex);
        }

        // Note: We keep the player's painted pixels even after disconnect
        // They just won't appear in the leaderboard anymore

        players.delete(playerId);
        playerPixelCounts.delete(playerId);

        console.log(`Total players: ${players.size}`);

        broadcast({
            type: 'playerLeft',
            playerId: playerId
        });

        // 방장이 나갔으면 새 방장 선정
        if (playerId === hostId) {
            assignNewHost();
        }

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
    if (gameTimer) {
        clearTimeout(gameTimer);
    }
    wss.clients.forEach(client => {
        client.close();
    });
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

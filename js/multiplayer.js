/**
 * Multiplayer Client Module for Dingcho Earth
 * COMPETITIVE MODE - Territory battle!
 *
 * Handles WebSocket connection and synchronization with server
 * Including game room system (host, timer, names)
 */

export class MultiplayerClient {
    constructor(options = {}) {
        this.serverUrl = options.serverUrl || 'ws://localhost:3001';
        this.ws = null;
        this.playerId = null;
        this.playerColor = null;
        this.playerName = null;
        this.isHost = false;
        this.hostId = null;
        this.gameState = 'waiting';  // 'waiting', 'playing'
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000;

        // Callbacks
        this.onConnected = options.onConnected || (() => {});
        this.onDisconnected = options.onDisconnected || (() => {});
        this.onPlayerJoined = options.onPlayerJoined || (() => {});
        this.onPlayerLeft = options.onPlayerLeft || (() => {});
        this.onPlayerMoved = options.onPlayerMoved || (() => {});
        this.onPainted = options.onPainted || (() => {});
        this.onPaintedBatch = options.onPaintedBatch || (() => {});
        this.onAreaFilled = options.onAreaFilled || (() => {}); // Territory fill callback
        this.onInitialState = options.onInitialState || (() => {});
        this.onLeaderboard = options.onLeaderboard || (() => {});
        this.onError = options.onError || (() => {});

        // Game room callbacks
        this.onHostChanged = options.onHostChanged || (() => {});
        this.onGameStarted = options.onGameStarted || (() => {});
        this.onGameEnded = options.onGameEnded || (() => {});
        this.onGameReset = options.onGameReset || (() => {});
        this.onTimeUpdate = options.onTimeUpdate || (() => {});

        // Stun callbacks
        this.onStunned = options.onStunned || (() => {}); // 내가 스턴 당했을 때
        this.onPlayerStunned = options.onPlayerStunned || (() => {}); // 다른 플레이어가 스턴 당했을 때

        // Item callbacks
        this.onItemSpawn = options.onItemSpawn || (() => {}); // 아이템 스폰
        this.onItemPickedUp = options.onItemPickedUp || (() => {}); // 아이템 픽업됨
        this.onItemUsed = options.onItemUsed || (() => {}); // 아이템 사용됨
        this.onMineTriggered = options.onMineTriggered || (() => {}); // 지뢰 발동
        this.onMissileHit = options.onMissileHit || (() => {}); // 미사일 명중

        // Position update throttling
        this.lastPositionUpdate = 0;
        this.positionUpdateInterval = 50; // ms (20 updates per second)

        // Paint buffer - position과 함께 전송
        this.paintBuffer = [];
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            console.log('Already connected or connecting');
            return;
        }

        console.log(`Connecting to ${this.serverUrl}...`);

        try {
            this.ws = new WebSocket(this.serverUrl);

            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            this.ws.onclose = (event) => {
                console.log('WebSocket disconnected:', event.code, event.reason);
                this.isConnected = false;
                this.onDisconnected();

                // Attempt reconnection
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
                    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                    setTimeout(() => this.connect(), delay);
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.onError(error);
            };
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.onError(error);
        }
    }

    handleMessage(data) {
        try {
            const message = JSON.parse(data);

            switch (message.type) {
                case 'welcome':
                    this.playerId = message.playerId;
                    this.playerColor = message.color;
                    this.isHost = message.isHost;
                    this.hostId = message.hostId;
                    this.gameState = message.gameState;
                    console.log(`Welcome! Player ID: ${this.playerId}, Color: ${this.playerColor}, Host: ${this.isHost}`);

                    // Send initial state to callback
                    this.onInitialState({
                        playerId: this.playerId,
                        color: this.playerColor,
                        isHost: this.isHost,
                        hostId: this.hostId,
                        gameState: this.gameState,
                        gameEndTime: message.gameEndTime,
                        position: message.position,
                        players: message.players,
                        paintData: message.paintData,
                        leaderboard: message.leaderboard || []
                    });

                    this.onConnected({
                        playerId: this.playerId,
                        color: this.playerColor,
                        isHost: this.isHost
                    });
                    break;

                case 'leaderboard':
                    this.onLeaderboard(message.rankings || []);
                    break;

                case 'playerJoined':
                    console.log(`Player joined: ${message.player.id} (${message.player.name})`);
                    this.onPlayerJoined(message.player);
                    break;

                case 'playerLeft':
                    console.log(`Player left: ${message.playerId}`);
                    this.onPlayerLeft(message.playerId);
                    break;

                case 'playerMoved':
                    this.onPlayerMoved({
                        playerId: message.playerId,
                        latitude: message.latitude,
                        longitude: message.longitude,
                        facingAngle: message.facingAngle,
                        isWalking: message.isWalking,
                        isRunning: message.isRunning,
                        isJumping: message.isJumping,
                        isDrowning: message.isDrowning,
                        isStunned: message.isStunned,
                        stunDuration: message.stunDuration,
                        // paint 데이터도 함께 전달
                        pixels: message.pixels,
                        color: message.color
                    });
                    break;

                case 'painted':
                    this.onPainted({
                        x: message.x,
                        y: message.y,
                        color: message.color,
                        playerId: message.playerId
                    });
                    break;

                case 'paintedBatch':
                    this.onPaintedBatch({
                        pixels: message.pixels,
                        color: message.color,
                        playerId: message.playerId
                    });
                    break;

                case 'areaFilled':
                    this.onAreaFilled({
                        pixels: message.pixels,
                        color: message.color,
                        playerId: message.playerId
                    });
                    break;

                case 'hostChanged':
                    this.hostId = message.hostId;
                    this.isHost = this.playerId === message.hostId;
                    console.log(`Host changed: ${message.hostId}, I am host: ${this.isHost}`);
                    this.onHostChanged({
                        hostId: message.hostId,
                        isHost: this.isHost
                    });
                    break;

                case 'gameStarted':
                    this.gameState = 'playing';
                    console.log(`Game started! Duration: ${message.duration / 1000}s`);
                    this.onGameStarted({
                        duration: message.duration,
                        startTime: message.startTime,
                        endTime: message.endTime
                    });
                    break;

                case 'gameEnded':
                    this.gameState = 'waiting';
                    console.log('Game ended!');
                    this.onGameEnded({
                        rankings: message.rankings
                    });
                    break;

                case 'gameReset':
                    this.hostId = message.hostId;
                    this.isHost = this.playerId === message.hostId;
                    console.log(`Game reset! New host: ${message.hostId}`);
                    this.onGameReset({
                        hostId: message.hostId,
                        isHost: this.isHost
                    });
                    break;

                case 'timeUpdate':
                    this.onTimeUpdate({
                        remaining: message.remaining
                    });
                    break;

                case 'pong':
                    // Handle pong response for latency measurement
                    const latency = Date.now() - message.timestamp;
                    console.log(`Latency: ${latency}ms`);
                    break;

                case 'stunned':
                    // 내가 스턴 당함
                    console.log(`I got stunned! Duration: ${message.duration}ms`);
                    this.onStunned({
                        duration: message.duration,
                        stunnedBy: message.stunnedBy
                    });
                    break;

                case 'playerStunned':
                    // 다른 플레이어가 스턴 당함
                    console.log(`Player ${message.playerId} got stunned!`);
                    this.onPlayerStunned({
                        playerId: message.playerId,
                        duration: message.duration,
                        stunnedBy: message.stunnedBy
                    });
                    break;

                // === ITEM MESSAGES ===
                case 'itemSpawn':
                    // 아이템 스폰
                    this.onItemSpawn({
                        items: message.items
                    });
                    break;

                case 'itemPickedUp':
                    // 아이템 픽업됨
                    this.onItemPickedUp({
                        itemId: message.itemId,
                        playerId: message.playerId
                    });
                    break;

                case 'itemUsed':
                    // 아이템 사용됨
                    this.onItemUsed({
                        playerId: message.playerId,
                        itemType: message.itemType,
                        data: message.data
                    });
                    break;

                case 'mineTriggered':
                    // 지뢰 발동
                    this.onMineTriggered({
                        mineId: message.mineId,
                        triggeredBy: message.triggeredBy
                    });
                    break;

                case 'missileHit':
                    // 미사일 명중
                    this.onMissileHit({
                        missileId: message.missileId
                    });
                    break;
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    }

    // 플레이어 이름 설정
    setName(name) {
        if (!this.isConnected) return;
        this.playerName = name;
        this.send({
            type: 'setName',
            name: name
        });
    }

    // 게임 시작 (방장만 가능)
    startGame(duration) {
        if (!this.isConnected || !this.isHost) return;
        this.send({
            type: 'startGame',
            duration: duration
        });
    }

    // Send position update with paint data (throttled)
    // 이동과 색상 정보를 하나의 메시지로 통합하여 전송
    sendPosition(latitude, longitude, facingAngle, state = {}) {
        if (!this.isConnected) return;

        const now = Date.now();
        if (now - this.lastPositionUpdate < this.positionUpdateInterval) {
            return; // Throttle
        }
        this.lastPositionUpdate = now;

        // position 메시지에 paint 데이터 포함
        const message = {
            type: 'position',
            latitude: latitude,
            longitude: longitude,
            facingAngle: facingAngle,
            isWalking: state.isWalking || false,
            isRunning: state.isRunning || false,
            isJumping: state.isJumping || false,
            isDrowning: state.isDrowning || false,
            isStunned: state.isStunned || false,
            stunDuration: state.stunDuration || 5
        };

        // 버퍼에 paint 데이터가 있으면 함께 전송
        if (this.paintBuffer.length > 0) {
            message.pixels = this.paintBuffer;
            this.paintBuffer = [];
        }

        this.send(message);
    }

    // Paint 데이터를 버퍼에 추가 (다음 position 전송 시 함께 전송됨)
    addPaint(x, y) {
        this.paintBuffer.push({ x, y });
    }

    // Send ping for latency measurement
    sendPing() {
        if (!this.isConnected) return;
        this.send({
            type: 'ping',
            timestamp: Date.now()
        });
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    disconnect() {
        if (this.ws) {
            this.maxReconnectAttempts = 0; // Prevent reconnection
            this.ws.close();
            this.ws = null;
        }
    }

    getPlayerId() {
        return this.playerId;
    }

    getPlayerColor() {
        return this.playerColor;
    }

    getIsHost() {
        return this.isHost;
    }

    getGameState() {
        return this.gameState;
    }
}

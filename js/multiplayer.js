/**
 * Multiplayer Client Module for Dingcho Earth
 * COMPETITIVE MODE - Territory battle!
 *
 * Handles WebSocket connection and synchronization with server
 */

export class MultiplayerClient {
    constructor(options = {}) {
        this.serverUrl = options.serverUrl || 'ws://localhost:3001';
        this.ws = null;
        this.playerId = null;
        this.playerColor = null;
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

        // Position update throttling
        this.lastPositionUpdate = 0;
        this.positionUpdateInterval = 50; // ms (20 updates per second)

        // Paint batch buffer - throttle 방식으로 변경 (이동과 동일한 주기)
        this.paintBuffer = [];
        this.lastPaintSend = 0;
        this.paintSendInterval = 50; // ms (이동과 동일한 50ms 간격)
        this.paintMaxBuffer = 20; // 버퍼가 이 크기 이상이면 즉시 전송
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
                    console.log(`Welcome! Player ID: ${this.playerId}, Color: ${this.playerColor}`);

                    // Send initial state to callback
                    this.onInitialState({
                        playerId: this.playerId,
                        color: this.playerColor,
                        position: message.position,
                        players: message.players,
                        paintData: message.paintData,
                        leaderboard: message.leaderboard || []
                    });

                    this.onConnected({
                        playerId: this.playerId,
                        color: this.playerColor
                    });
                    break;

                case 'leaderboard':
                    this.onLeaderboard(message.rankings || []);
                    break;

                case 'playerJoined':
                    console.log(`Player joined: ${message.player.id}`);
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
                        isDrowning: message.isDrowning
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

                case 'pong':
                    // Handle pong response for latency measurement
                    const latency = Date.now() - message.timestamp;
                    console.log(`Latency: ${latency}ms`);
                    break;
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    }

    // Send position update (throttled)
    sendPosition(latitude, longitude, facingAngle, state = {}) {
        if (!this.isConnected) return;

        const now = Date.now();
        if (now - this.lastPositionUpdate < this.positionUpdateInterval) {
            return; // Throttle
        }
        this.lastPositionUpdate = now;

        this.send({
            type: 'position',
            latitude: latitude,
            longitude: longitude,
            facingAngle: facingAngle,
            isWalking: state.isWalking || false,
            isRunning: state.isRunning || false,
            isJumping: state.isJumping || false,
            isDrowning: state.isDrowning || false
        });

        // 위치 전송 시 페인트 버퍼도 함께 체크하여 전송 (50ms 간격 보장)
        if (this.paintBuffer.length > 0 && now - this.lastPaintSend >= this.paintSendInterval) {
            this.flushPaintBuffer();
        }
    }

    // Buffer paint and send in batches (throttle 방식 - 이동과 동일한 주기)
    sendPaint(x, y) {
        if (!this.isConnected) return;

        this.paintBuffer.push({ x, y });

        const now = Date.now();
        const shouldSend =
            this.paintBuffer.length >= this.paintMaxBuffer || // 버퍼가 가득 찼으면 즉시 전송
            now - this.lastPaintSend >= this.paintSendInterval; // 또는 50ms 경과 시

        if (shouldSend) {
            this.flushPaintBuffer();
        }
    }

    // 버퍼에 있는 페인트 데이터 전송
    flushPaintBuffer() {
        if (this.paintBuffer.length === 0) return;

        if (this.paintBuffer.length === 1) {
            // Single pixel
            this.send({
                type: 'paint',
                x: this.paintBuffer[0].x,
                y: this.paintBuffer[0].y
            });
        } else {
            // Batch
            this.send({
                type: 'paintBatch',
                pixels: this.paintBuffer
            });
        }

        this.paintBuffer = [];
        this.lastPaintSend = Date.now();
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
}

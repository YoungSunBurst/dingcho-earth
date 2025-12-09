/**
 * Multiplayer Client Module for Dingcho Earth
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
        this.onInitialState = options.onInitialState || (() => {});
        this.onError = options.onError || (() => {});

        // Position update throttling
        this.lastPositionUpdate = 0;
        this.positionUpdateInterval = 50; // ms (20 updates per second)

        // Paint batch buffer
        this.paintBuffer = [];
        this.paintBufferTimeout = null;
        this.paintBufferDelay = 100; // ms
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
                        paintData: message.paintData
                    });

                    this.onConnected({
                        playerId: this.playerId,
                        color: this.playerColor
                    });
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
    }

    // Buffer paint and send in batches
    sendPaint(x, y) {
        if (!this.isConnected) return;

        this.paintBuffer.push({ x, y });

        // Debounce: send batch after delay
        if (this.paintBufferTimeout) {
            clearTimeout(this.paintBufferTimeout);
        }

        this.paintBufferTimeout = setTimeout(() => {
            if (this.paintBuffer.length > 0) {
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
            }
        }, this.paintBufferDelay);
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

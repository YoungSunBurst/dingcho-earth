import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Character } from './Character.js';
import { MultiplayerClient } from './multiplayer.js';

// === MULTIPLAYER ===
// 서버 URL 설정 (로컬 개발 또는 프로덕션)
const WS_SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
? 'ws://localhost:3001'
: `ws://${window.location.hostname}:9005`;

// 리모트 플레이어 저장소 (playerId -> { character, name, color })
const remotePlayers = new Map();
let multiplayerClient = null;
let myPlayerId = null;
let myPlayerName = null;
let isHost = false;
let gameState = 'waiting';  // 'waiting', 'playing'
let selectedGameDuration = 180000;  // 기본 3분

// Scene setup
const scene = new THREE.Scene();
const container = document.getElementById('canvas-container');

// Camera
const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.z = 3;

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000011);
container.appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 1.2;
controls.maxDistance = 10;
controls.enablePan = false;

// Texture loader
const textureLoader = new THREE.TextureLoader();

// Loading progress
let loadedCount = 0;
const totalTextures = 3;

// Texture URLs from GitHub (CORS-enabled)
const TEXTURES = {
    earth: 'https://raw.githubusercontent.com/miguelmota/threejs-earth/master/images/earthmap1k.jpg',
    clouds: 'https://raw.githubusercontent.com/miguelmota/threejs-earth/master/images/earthcloudmap.jpg'
};

// 육지/바다 판별을 위한 캔버스
let landMaskCanvas = null;
let landMaskCtx = null;
let landMaskImageData = null;

// 지구 텍스처 이미지 로드 (육지/바다 판별용)
const landMaskImage = new Image();
landMaskImage.crossOrigin = 'anonymous';
landMaskImage.onload = () => {
    landMaskCanvas = document.createElement('canvas');
    landMaskCanvas.width = landMaskImage.width;
    landMaskCanvas.height = landMaskImage.height;
    landMaskCtx = landMaskCanvas.getContext('2d');
    landMaskCtx.drawImage(landMaskImage, 0, 0);
    landMaskImageData = landMaskCtx.getImageData(0, 0, landMaskCanvas.width, landMaskCanvas.height);
    console.log('Earth texture loaded for land detection:', landMaskCanvas.width, 'x', landMaskCanvas.height);

    // 육지 픽셀 수 계산 (페인트 퍼센트 계산용)
    setTimeout(() => calculateTotalLandPixels(), 100);
};
landMaskImage.src = TEXTURES.earth;

// RGB를 HSL로 변환하는 함수
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    if (max === min) {
        return { h: 0, s: 0, l: l * 100 };
    }

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    let h;
    switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
    }

    return { h: h * 360, s: s * 100, l: l * 100 };
}

function isLandAtXY(x, y) {
    // 범위 체크
    const clampedX = Math.max(0, Math.min(landMaskCanvas.width - 1, x));
    const clampedY = Math.max(0, Math.min(landMaskCanvas.height - 1, y));

    // 픽셀 데이터 읽기 (RGBA)
    const index = (clampedY * landMaskCanvas.width + clampedX) * 4;
    const r = landMaskImageData.data[index];
    const g = landMaskImageData.data[index + 1];
    const b = landMaskImageData.data[index + 2];

    // RGB를 HSL로 변환하여 채도 확인
    const hsl = rgbToHsl(r, g, b);

    // 채도가 55% 이상이면 바다 (파란색 계열)
    // 따라서 채도가 55% 미만이면 육지
    return hsl.s < 55;
}

// 위도/경도로 육지인지 확인하는 함수
function isLandAt(lat, lon) {
    if (!landMaskImageData) return true; // 마스크 로드 전에는 모두 육지로 처리

    // 위도/경도를 텍스처 좌표로 변환
    // 경도: -180 ~ 180 -> 0 ~ width
    // 위도: 90 ~ -90 -> 0 ~ height
    const x = Math.floor(((lon + 180) / 360) * landMaskCanvas.width);
    const y = Math.floor(((90 - lat) / 180) * landMaskCanvas.height);
    return isLandAtXY(x, y);
}

// === PAINT SYSTEM ===
// HSL을 RGB로 변환
function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}

// 플레이어 색상 (서버에서 할당받음)
let playerColor = { hsl: 'hsl(0, 80%, 60%)' };

// 페인트 캔버스 (지구 텍스처와 동일한 크기)
const PAINT_WIDTH = 1000;
const PAINT_HEIGHT = 500;
let paintCanvas = null;
let paintCtx = null;
let paintTexture = null;
let paintedPixels = 0;
let totalLandPixels = 0;

// 페인트 캔버스 초기화
function initPaintCanvas() {
    paintCanvas = document.createElement('canvas');
    paintCanvas.width = PAINT_WIDTH;
    paintCanvas.height = PAINT_HEIGHT;
    paintCtx = paintCanvas.getContext('2d');

    // 투명하게 초기화
    paintCtx.clearRect(0, 0, PAINT_WIDTH, PAINT_HEIGHT);

    // Three.js 텍스처 생성
    paintTexture = new THREE.CanvasTexture(paintCanvas);
    paintTexture.needsUpdate = true;
}
initPaintCanvas();

// 육지 픽셀 수 계산 (landMaskImageData 로드 후 호출)
function calculateTotalLandPixels() {
    if (!landMaskImageData) return;

    totalLandPixels = 0;
    const width = landMaskCanvas.width;
    const height = landMaskCanvas.height;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4;
            const r = landMaskImageData.data[index];
            const g = landMaskImageData.data[index + 1];
            const b = landMaskImageData.data[index + 2];
            const hsl = rgbToHsl(r, g, b);

            if (hsl.s < 65) {
                totalLandPixels++;
            }
        }
    }
    console.log('Total land pixels:', totalLandPixels);
}

// 위도/경도에 색칠
// 픽셀 소유권 추적: key -> { playerId, color }
const pixelOwnership = new Map();
const PAINT_RADIUS = 3; // 브러시 크기

// 이전 칠한 위치 저장 (영역 연결용)
let lastPaintLat = null;
let lastPaintLon = null;

// 두 점 사이의 거리가 브러시 크기보다 큰지 확인하고, 중간 점 반환
function getMidpointIfNeeded(lat1, lon1, lat2, lon2) {
    // 텍스처 좌표로 변환
    const x1 = ((lon1 + 180) / 360) * PAINT_WIDTH;
    const y1 = ((90 - lat1) / 180) * PAINT_HEIGHT;
    const x2 = ((lon2 + 180) / 360) * PAINT_WIDTH;
    const y2 = ((90 - lat2) / 180) * PAINT_HEIGHT;

    // 경도 wrap around 처리
    let dx = x2 - x1;
    const dy = y2 - y1;

    if (Math.abs(dx) > PAINT_WIDTH / 2) {
        dx = dx > 0 ? dx - PAINT_WIDTH : dx + PAINT_WIDTH;
    }

    // 두 점 사이의 픽셀 거리
    const distance = Math.sqrt(dx * dx + dy * dy);

    // 브러시 지름보다 멀면 중간 점 필요
    if (distance > PAINT_RADIUS * 2) {
        // 중간 점 계산
        let midX = x1 + dx * 0.5;
        const midY = y1 + dy * 0.5;

        // wrap around 처리
        if (midX < 0) midX += PAINT_WIDTH;
        if (midX >= PAINT_WIDTH) midX -= PAINT_WIDTH;

        // 위도/경도로 변환
        const midLon = (midX / PAINT_WIDTH) * 360 - 180;
        const midLat = 90 - (midY / PAINT_HEIGHT) * 180;

        return { lat: midLat, lon: midLon };
    }

    return null;
}

// === 영역 채우기 시스템 (영역 기반) ===

// 현재 픽셀이 내 영역인지 확인
function isMyTerritory(x, y) {
    const key = `${x},${y}`;
    const owner = pixelOwnership.get(key);
    return owner && owner.playerId === myPlayerId;
}

// 닫힌 영역 찾기: 시작점에서 flood fill하여 내 영역으로 완전히 둘러싸여 있는지 확인
// 반환: { isClosed: boolean, pixels: [{x, y}, ...] }
function findEnclosedArea(startX, startY) {
    const visited = new Set();
    const enclosed = [];
    const queue = [[startX, startY]];
    let isClosed = true;

    const maxPixels = 50000; // 너무 큰 영역 방지

    while (queue.length > 0 && enclosed.length < maxPixels) {
        const [x, y] = queue.shift();
        const key = `${x},${y}`;

        if (visited.has(key)) continue;

        // 맵 상단/하단 경계에 닿으면 열린 영역
        if (y <= 0 || y >= PAINT_HEIGHT - 1) {
            isClosed = false;
            continue;
        }

        // 범위 체크
        if (x < 0 || x >= PAINT_WIDTH) continue;

        // 내 영역이면 경계로 처리 (탐색 안함)
        if (isMyTerritory(x, y)) continue;

        // 바다는 건너뛰기 (육지만 채움)
        if (!isLandAtXY(x, y)) continue;

        visited.add(key);
        enclosed.push({ x, y });

        // 4방향 탐색 (좌우는 wrap around)
        queue.push([(x + 1) % PAINT_WIDTH, y]);
        queue.push([(x - 1 + PAINT_WIDTH) % PAINT_WIDTH, y]);
        queue.push([x, y + 1]);
        queue.push([x, y - 1]);
    }

    // 너무 큰 영역은 열린 영역으로 처리
    if (enclosed.length >= maxPixels) {
        isClosed = false;
    }

    return { isClosed, pixels: enclosed };
}

// 내 영역으로 진입했을 때 주변의 닫힌 영역 찾기 및 채우기
function tryFillEnclosedAreas(centerX, centerY) {
    // 게임 중이 아니면 채우기 불가
    if (gameState !== 'playing') return 0;

    // 현재 위치 주변에서 내 영역이 아닌 픽셀들을 찾아서 닫힌 영역인지 확인
    const searchRadius = PAINT_RADIUS + 2;
    const checkedStarts = new Set();
    let totalFilled = 0;

    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            const sx = (centerX + dx + PAINT_WIDTH) % PAINT_WIDTH;
            const sy = Math.max(1, Math.min(PAINT_HEIGHT - 2, centerY + dy));
            const startKey = `${sx},${sy}`;

            // 이미 확인한 시작점이거나, 내 영역이거나, 바다면 스킵
            if (checkedStarts.has(startKey)) continue;
            if (isMyTerritory(sx, sy)) continue;
            if (!isLandAtXY(sx, sy)) continue;

            // 이 지점에서 닫힌 영역 탐색
            const result = findEnclosedArea(sx, sy);

            // 탐색한 모든 픽셀을 체크 완료로 표시
            result.pixels.forEach(p => checkedStarts.add(`${p.x},${p.y}`));

            // 닫힌 영역이고 최소 크기 이상이면 채우기
            if (result.isClosed && result.pixels.length >= 10 && result.pixels.length < 30000) {
                console.log(`Filling enclosed area: ${result.pixels.length} pixels`);

                // 캔버스에 그리기
                paintCtx.fillStyle = playerColor.hsl;
                result.pixels.forEach(p => {
                    paintCtx.fillRect(p.x, p.y, 1, 1);
                    const key = `${p.x},${p.y}`;
                    pixelOwnership.set(key, { playerId: myPlayerId, color: playerColor.hsl });
                });

                totalFilled += result.pixels.length;

                // 서버에 채운 영역 전송
                if (multiplayerClient && multiplayerClient.isConnected) {
                    multiplayerClient.send({
                        type: 'fillArea',
                        pixels: result.pixels
                    });
                }
            }
        }
    }

    if (totalFilled > 0 && paintTexture) {
        paintTexture.needsUpdate = true;
    }

    return totalFilled;
}

function paintAt(lat, lon, color = null, sendToServer = true) {
    if (!paintCanvas) return;

    // 게임 중이 아니면 칠하기 불가 (내가 칠하는 경우)
    if (!color && gameState !== 'playing') return;

    // 이동 불가 영역(바다)이면 칠하지 않음
    if (!isLandAt(lat, lon)) return;

    // 텍스처 좌표로 변환
    const x = Math.floor(((lon + 180) / 360) * PAINT_WIDTH);
    const y = Math.floor(((90 - lat) / 180) * PAINT_HEIGHT);

    let painted = false;
    let paintedAdjacentToMyTerritory = false; // 내 영역에 인접한 새 픽셀을 칠했는지
    const paintColor = color || playerColor.hsl;
    const painterId = color ? null : myPlayerId;
    paintCtx.fillStyle = paintColor;

    // 내가 칠하는 경우에만 영역 감지
    const isMyPainting = !color && painterId;

    // 브러시 크기만큼 원형으로 칠하기
    for (let dy = -PAINT_RADIUS; dy <= PAINT_RADIUS; dy++) {
        for (let dx = -PAINT_RADIUS; dx <= PAINT_RADIUS; dx++) {
            if (dx * dx + dy * dy <= PAINT_RADIUS * PAINT_RADIUS) {
                const px = (x + dx + PAINT_WIDTH) % PAINT_WIDTH;
                const py = Math.max(0, Math.min(PAINT_HEIGHT - 1, y + dy));

                const key = `${px},${py}`;
                const currentOwner = pixelOwnership.get(key);

                const isMyPixel = currentOwner && currentOwner.playerId === myPlayerId;

                if (!isMyPixel || color) {
                    if (isLandAtXY(px, py)) {
                        // 내가 칠하는 경우: 이 픽셀이 기존 내 영역에 인접한지 확인 (칠하기 전에)
                        if (isMyPainting && !isMyPixel && isAdjacentToMyTerritory(px, py)) {
                            paintedAdjacentToMyTerritory = true;
                        }

                        paintCtx.fillRect(px, py, 1, 1);
                        painted = true;

                        if (sendToServer && multiplayerClient && !color && !isMyPixel) {
                            multiplayerClient.addPaint(px, py);
                        }

                        if (isMyPainting) {
                            // 내 영역으로 저장
                            pixelOwnership.set(key, { playerId: painterId, color: paintColor });
                        }
                    }
                }
            }
        }
    }

    // 내가 칠하는 경우: 기존 영역에 인접한 새 픽셀을 칠했으면 닫힌 영역 확인
    if (isMyPainting && paintedAdjacentToMyTerritory) {
        tryFillEnclosedAreas(x, y);
    }

    // 텍스처 업데이트
    if (painted && paintTexture) {
        paintTexture.needsUpdate = true;
    }
}

// 이전 위치와 현재 위치를 연결하여 칠하기 (육지 영역만, 최적화 버전)
function paintConnectedAt(lat, lon) {
    if (!paintCanvas) return;

    // 게임 중이 아니면 칠하기 불가
    if (gameState !== 'playing') return;

    // 현재 위치가 육지가 아니면 칠하지 않고 이전 위치 초기화
    if (!isLandAt(lat, lon)) {
        lastPaintLat = null;
        lastPaintLon = null;
        return;
    }

    // 이전 위치가 있으면 중간 점 필요 여부 확인
    if (lastPaintLat !== null && lastPaintLon !== null) {
        // 두 점 사이 거리가 멀면 중간 점 하나만 추가
        const midpoint = getMidpointIfNeeded(lastPaintLat, lastPaintLon, lat, lon);
        if (midpoint && isLandAt(midpoint.lat, midpoint.lon)) {
            paintAt(midpoint.lat, midpoint.lon, null, true);
        }
    }

    // 현재 위치 칠하기
    paintAt(lat, lon, null, true);

    // 현재 위치를 이전 위치로 저장
    lastPaintLat = lat;
    lastPaintLon = lon;
}

// 칠하기 상태 초기화 (걷기 멈출 때 호출)
function resetPaintState() {
    lastPaintLat = null;
    lastPaintLon = null;
}

// 현재 픽셀이 내 영역에 인접한지 확인
function isAdjacentToMyTerritory(x, y) {
    const directions = [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [-1, 1], [1, -1], [1, 1]
    ];

    for (const [dx, dy] of directions) {
        const nx = (x + dx + PAINT_WIDTH) % PAINT_WIDTH;
        const ny = Math.max(0, Math.min(PAINT_HEIGHT - 1, y + dy));
        if (isMyTerritory(nx, ny)) {
            return true;
        }
    }
    return false;
}

// 서버에서 받은 페인트 데이터로 캔버스에 직접 그리기
function paintPixel(x, y, color, playerId = null) {
    if (!paintCanvas) return;

    const key = `${x},${y}`;

    // 소유권 업데이트
    pixelOwnership.set(key, { playerId: playerId, color: color });

    paintCtx.fillStyle = color;
    paintCtx.fillRect(x, y, 1, 1);

    if (paintTexture) {
        paintTexture.needsUpdate = true;
    }
}

// 서버에서 받은 영역 채우기 데이터 처리
function fillPixels(pixels, color, playerId) {
    if (!paintCanvas) return;

    paintCtx.fillStyle = color;
    pixels.forEach(p => {
        const key = `${p.x},${p.y}`;
        pixelOwnership.set(key, { playerId: playerId, color: color });
        paintCtx.fillRect(p.x, p.y, 1, 1);
    });

    if (paintTexture) {
        paintTexture.needsUpdate = true;
    }
}

// 페인트 캔버스 초기화 (게임 리셋 시)
function clearPaintCanvas() {
    if (!paintCanvas) return;

    paintCtx.clearRect(0, 0, PAINT_WIDTH, PAINT_HEIGHT);
    pixelOwnership.clear();

    if (paintTexture) {
        paintTexture.needsUpdate = true;
    }
}

// Create Earth
const earthGeometry = new THREE.SphereGeometry(1, 64, 64);

// Load textures
const earthDayTexture = textureLoader.load(
    TEXTURES.earth,
    () => updateLoading()
);

const cloudsTexture = textureLoader.load(
    TEXTURES.clouds,
    () => updateLoading()
);

function updateLoading() {
    loadedCount++;
    const progress = Math.round((loadedCount / totalTextures) * 100);
    document.getElementById('loading').textContent = `Loading... ${progress}%`;
    if (loadedCount >= totalTextures) {
        setTimeout(() => {
            document.getElementById('loading').style.display = 'none';
        }, 300);
    }
}

// Earth material
const earthMaterial = new THREE.MeshPhongMaterial({
    map: earthDayTexture,
    bumpScale: 0.05,
    specular: new THREE.Color(0x333333),
    shininess: 5
});

const earth = new THREE.Mesh(earthGeometry, earthMaterial);
// 지구 텍스처 매핑 조정 (경도 0이 그리니치에 맞도록)
earth.rotation.y = -Math.PI / 2;
scene.add(earth);

// Paint layer (지구 위에 색칠된 영역 표시)
const paintGeometry = new THREE.SphereGeometry(1.002, 64, 64);
const paintMaterial = new THREE.MeshBasicMaterial({
    map: paintTexture,
    transparent: true,
    opacity: 0.7,
    depthWrite: false
});
const paintLayer = new THREE.Mesh(paintGeometry, paintMaterial);
paintLayer.rotation.y = -Math.PI / 2;
scene.add(paintLayer);

// Clouds layer
const cloudsGeometry = new THREE.SphereGeometry(1.005, 64, 64);
const cloudsMaterial = new THREE.MeshPhongMaterial({
    map: cloudsTexture,
    transparent: true,
    opacity: 0.35,
    depthWrite: false
});

const clouds = new THREE.Mesh(cloudsGeometry, cloudsMaterial);
clouds.rotation.y = -Math.PI / 2;
scene.add(clouds);

// Atmosphere glow
const atmosphereGeometry = new THREE.SphereGeometry(1.12, 64, 64);
const atmosphereMaterial = new THREE.ShaderMaterial({
    vertexShader: `
        varying vec3 vNormal;
        void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        varying vec3 vNormal;
        void main() {
            float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
            gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity;
        }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true
});

const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
scene.add(atmosphere);

// Stars background
function createStars() {
    const starsGeometry = new THREE.BufferGeometry();
    const starsMaterial = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.02,
        sizeAttenuation: true
    });

    const starsVertices = [];
    for (let i = 0; i < 10000; i++) {
        const x = (Math.random() - 0.5) * 200;
        const y = (Math.random() - 0.5) * 200;
        const z = (Math.random() - 0.5) * 200;
        starsVertices.push(x, y, z);
    }

    starsGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(starsVertices, 3)
    );

    return new THREE.Points(starsGeometry, starsMaterial);
}

const stars = createStars();
scene.add(stars);

// Lighting
const ambientLight = new THREE.AmbientLight(0x444444);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
sunLight.position.set(5, 3, 5);
scene.add(sunLight);

// Add hemisphere light for better character visibility
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
scene.add(hemiLight);

// === CHARACTER ===
const character = new Character();
character.setPosition(37, 127); // 한국(서울) 근처에서 시작
character.landCheckFn = isLandAt; // 육지 체크 함수 연결
scene.add(character.group);

// 초기 카메라 위치를 캐릭터가 보이는 곳으로 설정
function initCameraPosition() {
    const charPos = character.group.position.clone();
    const charUp = charPos.clone().normalize();

    // 캐릭터에서 더 멀리, 더 높게 위치
    const cameraOffset = charUp.clone().multiplyScalar(1.5);

    camera.position.copy(charPos).add(cameraOffset);
    camera.lookAt(charPos);
    camera.up.copy(new THREE.Vector3(0, 1, 0));
}
initCameraPosition();

// 캐릭터 로드 완료
updateLoading();

// === MOBILE DETECTION ===
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 2) ||
    window.matchMedia("(pointer: coarse)").matches;

// === MOBILE CONTROLS STATE ===
const mobileInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    running: false,
    jump: false
};

// 조이스틱 상태
let joystickActive = false;
let joystickTouchId = null;

// === KEYBOARD CONTROLS ===
// e.code 기반으로 키 상태 관리 (한글 입력 모드에서도 동작하도록)
const keys = {
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    ShiftLeft: false,
    ShiftRight: false,
    Space: false
};

// 모달이 열려있으면 키 입력 무시
let isModalOpen = false;

document.addEventListener('keydown', (e) => {
    if (isModalOpen) return;

    // e.code를 사용하여 물리적 키 위치 기반으로 감지 (한글 입력 모드에서도 동작)
    if (e.code in keys) {
        keys[e.code] = true;
    }
    if (e.code === 'Space') {
        e.preventDefault(); // 페이지 스크롤 방지
    }
});

document.addEventListener('keyup', (e) => {
    // e.code를 사용하여 물리적 키 위치 기반으로 감지 (한글 입력 모드에서도 동작)
    if (e.code in keys) {
        keys[e.code] = false;
    }
});

function handleInput(deltaTime) {
    // 모달이 열려있으면 입력 무시
    if (isModalOpen) {
        character.stopWalking();
        return;
    }

    // 물에 빠진 동안에는 입력 무시
    if (character.isDrowning) {
        character.stopWalking();
        return;
    }

    let isMoving = false;

    // Shift: 달리기 모드 (좌/우 Shift 모두 지원) + 모바일 달리기
    character.setRunning(keys.ShiftLeft || keys.ShiftRight || mobileInput.running);

    // Space: 점프 + 모바일 점프
    if (keys.Space || mobileInput.jump) {
        character.jump();
        mobileInput.jump = false; // 점프는 한번만
    }

    // W / ↑: 앞으로 이동 + 모바일 조이스틱
    if (keys.KeyW || keys.ArrowUp || mobileInput.forward) {
        character.moveForward(deltaTime);
        isMoving = true;
    }
    // S / ↓: 뒤돌아보기 + 모바일 조이스틱
    if (keys.KeyS || keys.ArrowDown || mobileInput.backward) {
        character.turnAround(deltaTime);
        isMoving = true;
    }
    // A / ←: 왼쪽으로 회전 + 모바일 조이스틱
    if (keys.KeyA || keys.ArrowLeft || mobileInput.left) {
        character.turnLeft(deltaTime);
        isMoving = true;
    }
    // D / →: 오른쪽으로 회전 + 모바일 조이스틱
    if (keys.KeyD || keys.ArrowRight || mobileInput.right) {
        character.turnRight(deltaTime);
        isMoving = true;
    }

    if (!isMoving) {
        character.stopWalking();
    }
}

// === CAMERA MODES ===
let cameraMode = 'free'; // 'free', 'bird', 'front'
const followDistance = 0.3;
const followHeight = 0.15;

document.addEventListener('keydown', (e) => {
    if (isModalOpen) return;

    // e.code를 사용하여 한글 입력 모드에서도 카메라 전환 가능
    if (e.code === 'KeyF') {
        // F: 버드뷰 (위에서 내려다보기)
        if (cameraMode === 'bird') {
            cameraMode = 'free';
            controls.enabled = true;
        } else {
            cameraMode = 'bird';
            controls.enabled = false;
        }
        updateInfoText();
    }
    if (e.code === 'KeyV') {
        // V: 정면뷰 (캐릭터 뒤에서 앞쪽 바라보기)
        if (cameraMode === 'front') {
            cameraMode = 'free';
            controls.enabled = true;
        } else {
            cameraMode = 'front';
            controls.enabled = false;
        }
        updateInfoText();
    }
});

function updateInfoText() {
    const info = document.getElementById('info');
    if (cameraMode === 'bird') {
        info.innerHTML = `
            <strong>Bird View</strong> (F: toggle)<br>
            W: Forward | A/D: Turn | S: Turn around<br>
            Shift: Run | Space: Jump | V: Front view
        `;
    } else if (cameraMode === 'front') {
        info.innerHTML = `
            <strong>Front View</strong> (V: toggle)<br>
            W: Forward | A/D: Turn | S: Turn around<br>
            Shift: Run | Space: Jump | F: Bird view
        `;
    } else {
        info.innerHTML = `
            Drag to rotate | Scroll to zoom<br>
            W: Forward | A/D: Turn | S: Turn around<br>
            Shift: Run | Space: Jump<br>
            F: Bird view | V: Front view
        `;
    }
}

function updateCameraFollow() {
    if (cameraMode === 'free') return;

    const charPos = character.group.position.clone();
    const charUp = charPos.clone().normalize();

    if (cameraMode === 'bird') {
        // 버드뷰: 캐릭터 위에서 내려다보기
        const cameraOffset = charUp.clone().multiplyScalar(1.5);
        camera.position.copy(charPos).add(cameraOffset);

        // 캐릭터가 바라보는 방향을 up 벡터로 사용 (화면 상단이 캐릭터가 바라보는 방향)
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(character.group.quaternion);
        camera.up.copy(forward);
        camera.lookAt(charPos);
    } else if (cameraMode === 'front') {
        // 정면뷰: 캐릭터 뒤에서 캐릭터가 바라보는 방향으로 바라보기

        // 캐릭터의 로컬 좌표계 벡터들
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(character.group.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(character.group.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(character.group.quaternion);

        // 캐릭터 뒤쪽으로 카메라 이동
        const cameraBackOffset = forward.clone().multiplyScalar(-0.5);
        // 캐릭터 머리 높이 정도로 올리기
        const cameraUpOffset = up.clone().multiplyScalar(0.05);

        const cameraPos = charPos.clone().add(cameraBackOffset).add(cameraUpOffset);
        camera.position.copy(cameraPos);

        // 카메라가 바라볼 타겟 (캐릭터 앞쪽)
        const lookTarget = cameraPos.clone().add(forward.clone().multiplyScalar(1));

        // 카메라 up 벡터를 캐릭터의 up과 동일하게 설정
        camera.up.copy(up);
        camera.lookAt(lookTarget);
    }
}

// Clock for deltaTime
const clock = new THREE.Clock();

// === UI FUNCTIONS ===

// 모달 표시/숨기기
function showModal(modalId) {
    document.getElementById(modalId).classList.add('visible');
    isModalOpen = true;
}

function hideModal(modalId) {
    document.getElementById(modalId).classList.remove('visible');
    // 모든 모달이 닫혔는지 확인
    const modals = document.querySelectorAll('.modal-overlay');
    let anyOpen = false;
    modals.forEach(m => {
        if (m.classList.contains('visible')) anyOpen = true;
    });
    isModalOpen = anyOpen;
}

function hideAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => {
        m.classList.remove('visible');
    });
    isModalOpen = false;
}

// 타이머 포맷팅
function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// 타이머 업데이트
function updateTimer(remaining) {
    const timerEl = document.getElementById('game-timer');
    timerEl.textContent = formatTime(remaining);

    // 10초 이하면 경고 스타일
    if (remaining <= 10000) {
        timerEl.classList.add('warning');
    } else {
        timerEl.classList.remove('warning');
    }
}

// 방장 배지 업데이트
function updateHostBadge(isHostNow) {
    const badge = document.getElementById('host-badge');
    if (isHostNow) {
        badge.classList.add('visible');
    } else {
        badge.classList.remove('visible');
    }
}

// 게임 상태 업데이트
function updateGameState(state) {
    const stateEl = document.getElementById('game-state');
    stateEl.textContent = state === 'playing' ? 'Playing' : 'Waiting';
    stateEl.className = state === 'playing' ? 'playing' : '';
}

// 플레이어 목록 업데이트 (방장/대기 모달용)
function updatePlayerList(listId) {
    const listEl = document.getElementById(listId);
    if (!listEl) return;

    listEl.innerHTML = '';

    // 내 정보 추가
    if (myPlayerName) {
        const myItem = document.createElement('div');
        myItem.className = 'player-item';
        myItem.innerHTML = `
            <span class="color-dot" style="background-color: ${playerColor.hsl}"></span>
            <span>${myPlayerName} (You)</span>
        `;
        listEl.appendChild(myItem);
    }

    // 리모트 플레이어들 추가
    remotePlayers.forEach((data, id) => {
        if (data.name) {
            const item = document.createElement('div');
            item.className = 'player-item';
            item.innerHTML = `
                <span class="color-dot" style="background-color: ${data.color}"></span>
                <span>${data.name}</span>
            `;
            listEl.appendChild(item);
        }
    });
}

// === MULTIPLAYER FUNCTIONS ===

// 리모트 플레이어 생성
function createRemotePlayer(playerData) {
    if (remotePlayers.has(playerData.id)) {
        // 이미 존재하면 정보 업데이트
        const existing = remotePlayers.get(playerData.id);
        existing.name = playerData.name;
        return;
    }

    console.log(`Creating remote player: ${playerData.id} (${playerData.name}) with color ${playerData.color}`);

    const remoteCharacter = new Character({
        playerId: playerData.id,
        isRemote: true,
        color: playerData.color
    });

    remoteCharacter.setPosition(playerData.latitude, playerData.longitude);
    remoteCharacter.facingAngle = playerData.facingAngle || 0;
    remoteCharacter.targetLatitude = playerData.latitude;
    remoteCharacter.targetLongitude = playerData.longitude;
    remoteCharacter.targetFacingAngle = playerData.facingAngle || 0;
    remoteCharacter.landCheckFn = isLandAt;

    scene.add(remoteCharacter.group);
    remotePlayers.set(playerData.id, {
        character: remoteCharacter,
        name: playerData.name,
        color: playerData.color
    });

    updatePlayerCount();
    updatePlayerList('host-player-list');
    updatePlayerList('waiting-player-list');
}

// 리모트 플레이어 제거
function removeRemotePlayer(playerId) {
    const remoteData = remotePlayers.get(playerId);
    if (remoteData) {
        scene.remove(remoteData.character.group);
        remoteData.character.dispose();
        remotePlayers.delete(playerId);
        console.log(`Removed remote player: ${playerId}`);
        updatePlayerCount();
        updatePlayerList('host-player-list');
        updatePlayerList('waiting-player-list');
    }
}

// 플레이어 수 업데이트
function updatePlayerCount() {
    const countEl = document.getElementById('player-count');
    if (countEl) {
        countEl.textContent = remotePlayers.size + 1; // +1 for self
    }
}

// 리더보드 업데이트
function updateLeaderboard(rankings) {
    const leaderboardEl = document.getElementById('leaderboard-list');
    if (!leaderboardEl) return;

    leaderboardEl.innerHTML = '';

    rankings.forEach((player, index) => {
        const isMe = player.playerId === myPlayerId;
        const item = document.createElement('div');
        item.className = 'leaderboard-item' + (isMe ? ' me' : '');

        const rank = document.createElement('span');
        rank.className = 'rank';
        rank.textContent = `#${index + 1}`;

        const colorBox = document.createElement('span');
        colorBox.className = 'color-box';
        colorBox.style.backgroundColor = player.color;

        const name = document.createElement('span');
        name.className = 'player-name';
        name.textContent = player.name || 'Unknown';

        const pixels = document.createElement('span');
        pixels.className = 'pixels';
        pixels.textContent = player.pixelCount.toLocaleString();

        item.appendChild(rank);
        item.appendChild(colorBox);
        item.appendChild(name);
        item.appendChild(pixels);
        leaderboardEl.appendChild(item);
    });
}

// 게임 결과 표시
function showGameResult(rankings) {
    const resultList = document.getElementById('result-list');
    resultList.innerHTML = '';

    const medals = ['', '', ''];

    rankings.forEach((player, index) => {
        const isMe = player.playerId === myPlayerId;
        const isWinner = index === 0;

        const item = document.createElement('div');
        item.className = 'result-item' + (isWinner ? ' winner' : '') + (isMe ? ' me' : '');

        let medal = '';
        if (index === 0) medal = '';
        else if (index === 1) medal = '';
        else if (index === 2) medal = '';

        item.innerHTML = `
            <span class="medal">${medal}</span>
            <span class="result-rank">#${index + 1}</span>
            <span class="result-color" style="background-color: ${player.color}"></span>
            <span class="result-name">${player.name || 'Unknown'}${isMe ? ' (You)' : ''}</span>
            <span class="result-pixels">${player.pixelCount.toLocaleString()}</span>
        `;
        resultList.appendChild(item);
    });

    showModal('result-modal');
}

// 멀티플레이어 초기화
function initMultiplayer() {
    multiplayerClient = new MultiplayerClient({
        serverUrl: WS_SERVER_URL,

        onConnected: (data) => {
            console.log('Connected to multiplayer server!');
            myPlayerId = data.playerId;
            isHost = data.isHost;

            // 서버에서 받은 색상으로 업데이트
            playerColor = { hsl: data.color };
            document.getElementById('player-color').style.backgroundColor = data.color;
            document.getElementById('name-color-preview').style.backgroundColor = data.color;

            // 캐릭터 색상 업데이트
            character.updateColor(data.color);

            // 방장 배지 업데이트
            updateHostBadge(isHost);

            // 연결 상태 표시
            const statusEl = document.getElementById('connection-status');
            if (statusEl) {
                statusEl.textContent = 'Online';
                statusEl.style.color = '#4caf50';
            }

            // 이름 입력 모달 표시
            showModal('name-modal');
            document.getElementById('player-name-input').focus();
        },

        onDisconnected: () => {
            console.log('Disconnected from server');
            const statusEl = document.getElementById('connection-status');
            if (statusEl) {
                statusEl.textContent = 'Offline';
                statusEl.style.color = '#f44336';
            }
        },

        onInitialState: (state) => {
            console.log('Received initial state:', state);
            isHost = state.isHost;
            gameState = state.gameState;

            updateHostBadge(isHost);
            updateGameState(gameState);

            // 기존 플레이어들 생성
            state.players.forEach(p => {
                if (p.name) {  // 이름이 있는 플레이어만
                    createRemotePlayer(p);
                }
            });

            // 기존 페인트 데이터 적용
            if (state.paintData && state.paintData.length > 0) {
                console.log(`Applying ${state.paintData.length} paint pixels from server`);
                state.paintData.forEach(paint => {
                    const [x, y] = paint.key.split(',').map(Number);
                    paintPixel(x, y, paint.color, paint.playerId);
                });
            }

            // 초기 리더보드 설정
            if (state.leaderboard) {
                updateLeaderboard(state.leaderboard);
            }

            // 게임이 진행 중이면 타이머 표시
            if (state.gameState === 'playing' && state.gameEndTime) {
                const remaining = state.gameEndTime - Date.now();
                if (remaining > 0) {
                    document.getElementById('game-timer').classList.add('visible');
                    updateTimer(remaining);
                }
            }
        },

        onPlayerJoined: (player) => {
            createRemotePlayer(player);
        },

        onPlayerLeft: (playerId) => {
            removeRemotePlayer(playerId);
        },

        onPlayerMoved: (data) => {
            const remoteData = remotePlayers.get(data.playerId);
            if (remoteData) {
                remoteData.character.setRemoteState(data);
            }

            // 이동과 함께 전송된 paint 데이터 처리
            if (data.pixels && data.pixels.length > 0 && data.color) {
                data.pixels.forEach(pixel => {
                    paintPixel(pixel.x, pixel.y, data.color, data.playerId);
                });
            }
        },

        onPainted: (data) => {
            // 다른 플레이어가 칠한 경우 화면에 반영
            if (data.playerId !== myPlayerId) {
                paintPixel(data.x, data.y, data.color, data.playerId);
            } else {
                // 내가 칠한 경우에도 소유권 업데이트
                const key = `${data.x},${data.y}`;
                pixelOwnership.set(key, { playerId: data.playerId, color: data.color });
            }
        },

        onPaintedBatch: (data) => {
            // 다른 플레이어가 칠한 경우 화면에 반영
            if (data.playerId !== myPlayerId) {
                data.pixels.forEach(pixel => {
                    paintPixel(pixel.x, pixel.y, data.color, data.playerId);
                });
            } else {
                // 내가 칠한 경우에도 소유권 업데이트
                data.pixels.forEach(pixel => {
                    const key = `${pixel.x},${pixel.y}`;
                    pixelOwnership.set(key, { playerId: data.playerId, color: data.color });
                });
            }
        },

        onAreaFilled: (data) => {
            // 다른 플레이어가 영역을 채운 경우
            if (data.playerId !== myPlayerId) {
                console.log(`Player ${data.playerId} filled ${data.pixels.length} pixels`);
                fillPixels(data.pixels, data.color, data.playerId);
            }
        },

        onLeaderboard: (rankings) => {
            updateLeaderboard(rankings);
        },

        onHostChanged: (data) => {
            isHost = data.isHost;
            updateHostBadge(isHost);

            // 대기 중이고 이름이 설정되었으면 모달 업데이트
            if (gameState === 'waiting' && myPlayerName) {
                hideAllModals();
                if (isHost) {
                    updatePlayerList('host-player-list');
                    showModal('host-modal');
                } else {
                    updatePlayerList('waiting-player-list');
                    showModal('waiting-modal');
                }
            }
        },

        onGameStarted: (data) => {
            console.log('Game started!');
            gameState = 'playing';
            updateGameState('playing');

            // 페인트 캔버스 초기화
            clearPaintCanvas();

            // 모든 모달 닫기
            hideAllModals();

            // 타이머 표시
            document.getElementById('game-timer').classList.add('visible');
            updateTimer(data.duration);
        },

        onGameEnded: (data) => {
            console.log('Game ended!');
            gameState = 'waiting';
            updateGameState('waiting');

            // 타이머 숨기기
            document.getElementById('game-timer').classList.remove('visible');
            document.getElementById('game-timer').classList.remove('warning');

            // 결과 표시
            showGameResult(data.rankings);
        },

        onGameReset: (data) => {
            console.log('Game reset!');
            isHost = data.isHost;
            updateHostBadge(isHost);

            // 페인트 캔버스 초기화
            clearPaintCanvas();

            // 결과 모달이 닫혀있으면 방장/대기 모달 표시
            // (결과 모달은 사용자가 확인 버튼을 누를 때까지 유지)
            const resultModal = document.getElementById('result-modal');
            if (!resultModal.classList.contains('visible')) {
                if (isHost) {
                    updatePlayerList('host-player-list');
                    showModal('host-modal');
                } else {
                    updatePlayerList('waiting-player-list');
                    showModal('waiting-modal');
                }
            }
        },

        onTimeUpdate: (data) => {
            updateTimer(data.remaining);
        },

        onError: (error) => {
            console.error('Multiplayer error:', error);
        }
    });

    // 연결 시도
    multiplayerClient.connect();
}

// 내 위치를 서버에 전송
function sendMyPosition() {
    if (multiplayerClient && multiplayerClient.isConnected) {
        multiplayerClient.sendPosition(
            character.latitude,
            character.longitude,
            character.facingAngle,
            {
                isWalking: character.isWalking,
                isRunning: character.isRunning,
                isJumping: character.isJumping,
                isDrowning: character.isDrowning
            }
        );
    }
}

// === UI EVENT HANDLERS ===

// 이름 입력 제출
document.getElementById('name-submit-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('player-name-input');
    const name = nameInput.value.trim();

    if (name.length === 0) {
        nameInput.style.borderColor = '#f44336';
        return;
    }

    myPlayerName = name;
    document.getElementById('my-name').textContent = name;

    // 서버에 이름 전송
    multiplayerClient.setName(name);

    // 이름 모달 숨기기
    hideModal('name-modal');

    // 게임 상태에 따라 다음 모달 표시
    if (gameState === 'waiting') {
        if (isHost) {
            updatePlayerList('host-player-list');
            showModal('host-modal');
        } else {
            updatePlayerList('waiting-player-list');
            showModal('waiting-modal');
        }
    }
});

// 엔터키로 이름 제출
document.getElementById('player-name-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('name-submit-btn').click();
    }
});

// 게임 시간 선택
document.querySelectorAll('.time-option').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.time-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedGameDuration = parseInt(btn.dataset.time);
    });
});

// 게임 시작 버튼
document.getElementById('start-game-btn').addEventListener('click', () => {
    if (isHost && multiplayerClient) {
        multiplayerClient.startGame(selectedGameDuration);
    }
});

// 결과 확인 버튼 (로컬 동작 - 각자 결과 모달을 닫고 대기 화면으로 이동)
document.getElementById('result-confirm-btn').addEventListener('click', () => {
    hideModal('result-modal');

    // 대기 중이면 방장/대기 모달 표시
    if (gameState === 'waiting') {
        if (isHost) {
            updatePlayerList('host-player-list');
            showModal('host-modal');
        } else {
            updatePlayerList('waiting-player-list');
            showModal('waiting-modal');
        }
    }
});

// Animation
function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();

    // Handle keyboard input
    handleInput(deltaTime);

    // Update character animation
    character.update(deltaTime);

    // 리모트 플레이어들 업데이트
    remotePlayers.forEach(remoteData => {
        remoteData.character.update(deltaTime);
    });

    // 캐릭터가 걷고 있고 물에 빠지지 않았으면 현재 위치에 색칠 (이전 위치와 연결)
    if (character.isWalking && !character.isDrowning && gameState === 'playing') {
        paintConnectedAt(character.latitude, character.longitude);
    } else {
        // 걷기를 멈추면 이전 위치 초기화
        resetPaintState();
    }

    // 내 위치를 서버에 전송
    sendMyPosition();

    // Slow Earth rotation (disabled when character is on it)
    // earth.rotation.y += 0.0005;
    clouds.rotation.y += 0.0003;

    // Camera follow
    updateCameraFollow();

    // OrbitControls는 free 모드에서만 업데이트
    if (cameraMode === 'free') {
        controls.update();
    }
    renderer.render(scene, camera);
}

// Handle resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initialize info text
updateInfoText();

// Initialize multiplayer
initMultiplayer();

// Start animation
animate();

// === MOBILE CONTROLS ===
if (isMobile) {
    console.log('Mobile device detected, initializing touch controls');

    const joystickContainer = document.getElementById('joystick-container');
    const joystickBase = document.getElementById('joystick-base');
    const joystickStick = document.getElementById('joystick-stick');
    const jumpButton = document.getElementById('jump-button');
    const runButton = document.getElementById('run-button');

    const joystickRadius = 70; // 조이스틱 베이스 반지름
    const stickRadius = 30;    // 스틱 반지름
    const maxDistance = joystickRadius - stickRadius; // 스틱이 움직일 수 있는 최대 거리

    // 조이스틱 터치 핸들러
    function handleJoystickStart(e) {
        e.preventDefault();
        const touch = e.changedTouches[0];
        joystickTouchId = touch.identifier;
        joystickActive = true;
        joystickStick.classList.add('active');
        handleJoystickMove(e);
    }

    function handleJoystickMove(e) {
        e.preventDefault();
        if (!joystickActive) return;

        let touch = null;
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].identifier === joystickTouchId) {
                touch = e.touches[i];
                break;
            }
        }
        if (!touch) return;

        const rect = joystickBase.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        let deltaX = touch.clientX - centerX;
        let deltaY = touch.clientY - centerY;

        // 거리 계산
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        // 최대 거리 제한
        if (distance > maxDistance) {
            deltaX = (deltaX / distance) * maxDistance;
            deltaY = (deltaY / distance) * maxDistance;
        }

        // 스틱 위치 업데이트
        joystickStick.style.transform = `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px))`;

        // 입력 방향 계산 (데드존 적용)
        const deadzone = 0.25;
        const normalizedX = deltaX / maxDistance;
        const normalizedY = deltaY / maxDistance;

        // 방향 입력 업데이트
        mobileInput.forward = normalizedY < -deadzone;
        mobileInput.backward = normalizedY > deadzone;
        mobileInput.left = normalizedX < -deadzone;
        mobileInput.right = normalizedX > deadzone;
    }

    function handleJoystickEnd(e) {
        e.preventDefault();

        // 해당 터치가 종료되었는지 확인
        let touchEnded = true;
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].identifier === joystickTouchId) {
                touchEnded = false;
                break;
            }
        }

        if (touchEnded) {
            joystickActive = false;
            joystickTouchId = null;
            joystickStick.classList.remove('active');

            // 스틱 위치 초기화
            joystickStick.style.transform = 'translate(-50%, -50%)';

            // 입력 초기화
            mobileInput.forward = false;
            mobileInput.backward = false;
            mobileInput.left = false;
            mobileInput.right = false;
        }
    }

    // 조이스틱 이벤트 등록
    joystickContainer.addEventListener('touchstart', handleJoystickStart, { passive: false });
    joystickContainer.addEventListener('touchmove', handleJoystickMove, { passive: false });
    joystickContainer.addEventListener('touchend', handleJoystickEnd, { passive: false });
    joystickContainer.addEventListener('touchcancel', handleJoystickEnd, { passive: false });

    // 점프 버튼 터치 핸들러
    jumpButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        jumpButton.classList.add('active');
        mobileInput.jump = true;
    }, { passive: false });

    jumpButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        jumpButton.classList.remove('active');
    }, { passive: false });

    jumpButton.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        jumpButton.classList.remove('active');
    }, { passive: false });

    // 달리기 버튼 터치 핸들러 (토글 방식)
    runButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        mobileInput.running = !mobileInput.running;
        runButton.classList.toggle('active', mobileInput.running);
    }, { passive: false });

    // === TWO FINGER CAMERA CONTROLS ===
    let lastTouchDistance = 0;
    let lastTouchAngle = 0;
    let lastTouchCenter = { x: 0, y: 0 };
    let isTwoFingerTouch = false;

    // 캔버스 터치 이벤트 (카메라 조작)
    const canvas = renderer.domElement;

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            isTwoFingerTouch = true;

            const touch1 = e.touches[0];
            const touch2 = e.touches[1];

            // 두 손가락 사이의 거리와 각도 계산
            const dx = touch2.clientX - touch1.clientX;
            const dy = touch2.clientY - touch1.clientY;
            lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
            lastTouchAngle = Math.atan2(dy, dx);
            lastTouchCenter = {
                x: (touch1.clientX + touch2.clientX) / 2,
                y: (touch1.clientY + touch2.clientY) / 2
            };
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && isTwoFingerTouch && cameraMode === 'free') {
            e.preventDefault();

            const touch1 = e.touches[0];
            const touch2 = e.touches[1];

            // 현재 두 손가락 상태 계산
            const dx = touch2.clientX - touch1.clientX;
            const dy = touch2.clientY - touch1.clientY;
            const currentDistance = Math.sqrt(dx * dx + dy * dy);
            const currentAngle = Math.atan2(dy, dx);
            const currentCenter = {
                x: (touch1.clientX + touch2.clientX) / 2,
                y: (touch1.clientY + touch2.clientY) / 2
            };

            // 줌 (핀치)
            const zoomDelta = (currentDistance - lastTouchDistance) * 0.01;
            const currentZoom = camera.position.length();
            const newZoom = Math.max(controls.minDistance, Math.min(controls.maxDistance, currentZoom - zoomDelta));
            camera.position.normalize().multiplyScalar(newZoom);

            // 회전 (드래그)
            const rotateX = (currentCenter.x - lastTouchCenter.x) * 0.005;
            const rotateY = (currentCenter.y - lastTouchCenter.y) * 0.005;

            // OrbitControls의 spherical 좌표를 직접 조정
            const spherical = new THREE.Spherical();
            spherical.setFromVector3(camera.position);
            spherical.theta -= rotateX;
            spherical.phi += rotateY;
            spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
            camera.position.setFromSpherical(spherical);
            camera.lookAt(0, 0, 0);

            // 상태 업데이트
            lastTouchDistance = currentDistance;
            lastTouchAngle = currentAngle;
            lastTouchCenter = currentCenter;
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
            isTwoFingerTouch = false;
        }
    }, { passive: false });

    canvas.addEventListener('touchcancel', () => {
        isTwoFingerTouch = false;
    }, { passive: false });

    // 모바일에서 OrbitControls 비활성화 (two finger로만 조작)
    controls.enabled = false;
    controls.enableRotate = false;
    controls.enableZoom = false;

    // 모바일에서 기본 카메라 모드를 bird view로 설정
    cameraMode = 'bird';
}

// Export for debugging
export { scene, earth, camera, renderer, character, remotePlayers, multiplayerClient, isMobile };

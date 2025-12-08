import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Character } from './Character.js';

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
    clouds: 'https://raw.githubusercontent.com/miguelmota/threejs-earth/master/images/earthcloudmap.jpg',
    landMask: 'https://raw.githubusercontent.com/turban/webgl-earth/master/images/earthspec1k.jpg'
};

// 육지/바다 판별을 위한 캔버스
let landMaskCanvas = null;
let landMaskCtx = null;
let landMaskImageData = null;

// 육지/바다 마스크 이미지 로드
const landMaskImage = new Image();
landMaskImage.crossOrigin = 'anonymous';
landMaskImage.onload = () => {
    landMaskCanvas = document.createElement('canvas');
    landMaskCanvas.width = landMaskImage.width;
    landMaskCanvas.height = landMaskImage.height;
    landMaskCtx = landMaskCanvas.getContext('2d');
    landMaskCtx.drawImage(landMaskImage, 0, 0);
    landMaskImageData = landMaskCtx.getImageData(0, 0, landMaskCanvas.width, landMaskCanvas.height);
    console.log('Land mask loaded:', landMaskCanvas.width, 'x', landMaskCanvas.height);
};
landMaskImage.src = TEXTURES.landMask;

// 위도/경도로 육지인지 확인하는 함수
function isLandAt(lat, lon) {
    if (!landMaskImageData) return true; // 마스크 로드 전에는 모두 육지로 처리

    // 위도/경도를 텍스처 좌표로 변환
    // 경도: -180 ~ 180 -> 0 ~ width
    // 위도: 90 ~ -90 -> 0 ~ height
    const x = Math.floor(((lon + 180) / 360) * landMaskCanvas.width);
    const y = Math.floor(((90 - lat) / 180) * landMaskCanvas.height);

    // 범위 체크
    const clampedX = Math.max(0, Math.min(landMaskCanvas.width - 1, x));
    const clampedY = Math.max(0, Math.min(landMaskCanvas.height - 1, y));

    // 픽셀 데이터 읽기 (RGBA)
    const index = (clampedY * landMaskCanvas.width + clampedX) * 4;
    const r = landMaskImageData.data[index];

    // 밝기가 일정 이상이면 육지 (specular map에서 육지는 밝음)
    return r > 50;
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

// === KEYBOARD CONTROLS ===
const keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    shift: false,
    space: false
};

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key in keys) keys[key] = true;
    if (e.key in keys) keys[e.key] = true;
    if (e.key === 'Shift') keys.shift = true;
    if (e.key === ' ') {
        keys.space = true;
        e.preventDefault(); // 페이지 스크롤 방지
    }
});

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (key in keys) keys[key] = false;
    if (e.key in keys) keys[e.key] = false;
    if (e.key === 'Shift') keys.shift = false;
    if (e.key === ' ') keys.space = false;
});

function handleInput(deltaTime) {
    let isMoving = false;

    // Shift: 달리기 모드
    character.setRunning(keys.shift);

    // Space: 점프
    if (keys.space) {
        character.jump();
    }

    // W / ↑: 앞으로 이동
    if (keys.w || keys.ArrowUp) {
        character.moveForward(deltaTime);
        isMoving = true;
    }
    // S / ↓: 뒤돌아보기
    if (keys.s || keys.ArrowDown) {
        character.turnAround(deltaTime);
        isMoving = true;
    }
    // A / ←: 왼쪽으로 회전
    if (keys.a || keys.ArrowLeft) {
        character.turnLeft(deltaTime);
        isMoving = true;
    }
    // D / →: 오른쪽으로 회전
    if (keys.d || keys.ArrowRight) {
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
    if (e.key === 'f' || e.key === 'F') {
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
    if (e.key === 'v' || e.key === 'V') {
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
        camera.lookAt(charPos);
        camera.up.copy(new THREE.Vector3(0, 1, 0));
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

// Animation
function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();

    // Handle keyboard input
    handleInput(deltaTime);

    // Update character animation
    character.update(deltaTime);

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

// Start animation
animate();

// Export for debugging
export { scene, earth, camera, renderer, character };

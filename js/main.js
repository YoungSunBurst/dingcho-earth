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
    clouds: 'https://raw.githubusercontent.com/miguelmota/threejs-earth/master/images/earthcloudmap.jpg'
};

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
character.setPosition(35, 139); // 도쿄 근처에서 시작
scene.add(character.group);

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
    ArrowRight: false
};

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key in keys) keys[key] = true;
    if (e.key in keys) keys[e.key] = true;
});

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (key in keys) keys[key] = false;
    if (e.key in keys) keys[e.key] = false;
});

function handleInput() {
    let isMoving = false;

    if (keys.w || keys.ArrowUp) {
        character.moveForward();
        isMoving = true;
    }
    if (keys.s || keys.ArrowDown) {
        character.moveBackward();
        isMoving = true;
    }
    if (keys.a || keys.ArrowLeft) {
        character.moveLeft();
        isMoving = true;
    }
    if (keys.d || keys.ArrowRight) {
        character.moveRight();
        isMoving = true;
    }

    if (!isMoving) {
        character.stopWalking();
    }
}

// === CAMERA FOLLOW MODE ===
let followMode = false;
const followDistance = 0.3;
const followHeight = 0.15;

document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
        followMode = !followMode;
        controls.enabled = !followMode;
        updateInfoText();
    }
});

function updateInfoText() {
    const info = document.getElementById('info');
    if (followMode) {
        info.innerHTML = `
            <strong>Follow Mode ON</strong> (Press F to toggle)<br>
            WASD / Arrow Keys: Move character
        `;
    } else {
        info.innerHTML = `
            Drag to rotate | Scroll to zoom<br>
            WASD / Arrow Keys: Move character<br>
            F: Toggle follow camera
        `;
    }
}

function updateCameraFollow() {
    if (!followMode) return;

    const charPos = character.group.position.clone();
    const charUp = charPos.clone().normalize();

    // 캐릭터 뒤쪽 위에서 바라보기
    const cameraOffset = charUp.clone().multiplyScalar(followHeight);
    const backDirection = new THREE.Vector3(0, 0, 1).applyQuaternion(character.group.quaternion);
    cameraOffset.add(backDirection.multiplyScalar(followDistance));

    camera.position.copy(charPos).add(cameraOffset);
    camera.lookAt(charPos);
    camera.up.copy(charUp);
}

// Clock for deltaTime
const clock = new THREE.Clock();

// Animation
function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();

    // Handle keyboard input
    handleInput();

    // Update character animation
    character.update(deltaTime);

    // Slow Earth rotation (disabled when character is on it)
    // earth.rotation.y += 0.0005;
    clouds.rotation.y += 0.0003;

    // Camera follow
    updateCameraFollow();

    controls.update();
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

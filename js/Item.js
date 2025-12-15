/**
 * Item System for Dingcho Earth
 *
 * Item Types:
 * - GUN: Shoot a missile, stun on hit
 * - MINE: Place on ground, stun on step (including self)
 * - BAT: Swing for 10 seconds, stun on hit
 * - SPRINT: Run and stun on collision
 */

import * as THREE from 'three';

// Item type definitions
export const ITEM_TYPES = {
    GUN: 'gun',
    MINE: 'mine',
    BAT: 'bat',
    SPRINT: 'sprint'
};

// Item configurations
export const ITEM_CONFIG = {
    [ITEM_TYPES.GUN]: {
        name: 'Gun',
        icon: '🔫',
        color: 0xf44336,
        stunDuration: 5000,
        missileSpeed: 4.0  // 2x faster
    },
    [ITEM_TYPES.MINE]: {
        name: 'Mine',
        icon: '💣',
        color: 0x795548,
        stunDuration: 5000,
        triggerRadius: 0.03
    },
    [ITEM_TYPES.BAT]: {
        name: 'Bat',
        icon: '🏏',
        color: 0x9c27b0,
        stunDuration: 3000,
        duration: 10000,
        hitRadius: 0.05
    },
    [ITEM_TYPES.SPRINT]: {
        name: 'Sprint',
        icon: '⚡',
        color: 0xffeb3b,
        stunDuration: 3000,
        duration: 5000,
        collisionRadius: 0.04
    }
};

// Gift box item on map
export class ItemBox {
    constructor(options = {}) {
        this.id = options.id || `item_${Math.random().toString(36).substr(2, 9)}`;
        this.itemType = options.itemType || this.randomItemType();
        this.latitude = options.latitude || 0;
        this.longitude = options.longitude || 0;
        this.earthRadius = options.earthRadius || 1;

        this.group = new THREE.Group();
        this.animationTime = 0;
        this.isCollected = false;

        this.createVisual();
        this.updatePosition();
    }

    randomItemType() {
        const types = Object.values(ITEM_TYPES);
        return types[Math.floor(Math.random() * types.length)];
    }

    createVisual() {
        // Gift box body
        const boxSize = 0.02;
        const boxGeom = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
        const boxMat = new THREE.MeshToonMaterial({
            color: 0xff9800,
            emissive: 0xff9800,
            emissiveIntensity: 0.2
        });
        this.box = new THREE.Mesh(boxGeom, boxMat);
        this.box.position.y = boxSize / 2 + 0.005;
        this.group.add(this.box);

        // Ribbon on top
        const ribbonGeom = new THREE.BoxGeometry(boxSize * 1.2, boxSize * 0.15, boxSize * 0.15);
        const ribbonMat = new THREE.MeshToonMaterial({ color: 0xe91e63 });
        const ribbonH = new THREE.Mesh(ribbonGeom, ribbonMat);
        ribbonH.position.y = boxSize / 2 + 0.005;
        this.box.add(ribbonH);

        const ribbonV = new THREE.Mesh(ribbonGeom, ribbonMat);
        ribbonV.rotation.y = Math.PI / 2;
        ribbonV.position.y = boxSize / 2 + 0.005;
        this.box.add(ribbonV);

        // Bow on top
        const bowGeom = new THREE.SphereGeometry(boxSize * 0.2, 8, 8);
        const bowMat = new THREE.MeshToonMaterial({ color: 0xe91e63 });
        const bow = new THREE.Mesh(bowGeom, bowMat);
        bow.position.y = boxSize * 0.7;
        this.box.add(bow);

        // Question mark floating above
        // Using simple text representation with a small sphere
        const questionGeom = new THREE.SphereGeometry(0.005, 8, 8);
        const questionMat = new THREE.MeshToonMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 0.5
        });
        this.questionMark = new THREE.Mesh(questionGeom, questionMat);
        this.questionMark.position.y = boxSize * 1.5;
        this.box.add(this.questionMark);
    }

    updatePosition() {
        const lat = THREE.MathUtils.degToRad(this.latitude);
        const lon = THREE.MathUtils.degToRad(this.longitude);

        const r = this.earthRadius + 0.01;

        const x = r * Math.cos(lat) * Math.sin(lon);
        const y = r * Math.sin(lat);
        const z = r * Math.cos(lat) * Math.cos(lon);

        this.group.position.set(x, y, z);

        // Align to earth surface
        const up = new THREE.Vector3(x, y, z).normalize();
        const defaultUp = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(defaultUp, up);
        this.group.quaternion.copy(quaternion);
    }

    update(deltaTime) {
        if (this.isCollected) return;

        this.animationTime += deltaTime;

        // Floating animation
        if (this.box) {
            this.box.position.y = 0.015 + Math.sin(this.animationTime * 2) * 0.005;
            this.box.rotation.y += deltaTime * 1.5;
        }

        // Question mark pulse
        if (this.questionMark) {
            const scale = 1 + Math.sin(this.animationTime * 4) * 0.3;
            this.questionMark.scale.setScalar(scale);
        }
    }

    // Check if a position is close enough to pick up
    canPickup(lat, lon, pickupRadius = 0.03) {
        const latDiff = Math.abs(this.latitude - lat);
        const lonDiff = Math.abs(this.longitude - lon);

        // Handle wrap-around for longitude
        const adjustedLonDiff = Math.min(lonDiff, 360 - lonDiff);

        // Simple distance check (not true spherical but good enough)
        const distance = Math.sqrt(latDiff * latDiff + adjustedLonDiff * adjustedLonDiff);
        return distance < pickupRadius * 100; // Convert to degrees roughly
    }

    collect() {
        this.isCollected = true;
        // Hide the item
        this.group.visible = false;
    }

    dispose() {
        this.group.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }
}

// Missile for gun item
export class Missile {
    constructor(options = {}) {
        this.id = options.id || `missile_${Math.random().toString(36).substr(2, 9)}`;
        this.ownerId = options.ownerId;
        this.startLat = options.startLat || 0;
        this.startLon = options.startLon || 0;
        this.direction = options.direction || 0; // Facing angle
        this.earthRadius = options.earthRadius || 1;
        this.speed = options.speed || 2.0;

        this.latitude = this.startLat;
        this.longitude = this.startLon;
        this.lifetime = 0;
        this.maxLifetime = 3; // seconds
        this.isActive = true;

        this.group = new THREE.Group();
        this.createVisual();
        this.updatePosition();
    }

    createVisual() {
        // Missile body - 구 형태로 변경
        const bodyGeom = new THREE.SphereGeometry(0.008, 16, 16);
        const bodyMat = new THREE.MeshToonMaterial({
            color: 0xff5722,
            emissive: 0xff5722,
            emissiveIntensity: 0.4
        });
        this.body = new THREE.Mesh(bodyGeom, bodyMat);
        this.group.add(this.body);

        // 내부 코어 (더 밝게)
        const coreGeom = new THREE.SphereGeometry(0.004, 12, 12);
        const coreMat = new THREE.MeshBasicMaterial({
            color: 0xffeb3b,
            transparent: true,
            opacity: 0.9
        });
        const core = new THREE.Mesh(coreGeom, coreMat);
        this.body.add(core);

        // Trail particles (더 많이, 더 길게)
        this.trail = new THREE.Group();
        for (let i = 0; i < 8; i++) {
            const particleGeom = new THREE.SphereGeometry(0.005 - i * 0.0005, 8, 8);
            const particleMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color().setHSL(0.08 - i * 0.01, 1, 0.6 - i * 0.05),
                transparent: true,
                opacity: 0.9 - i * 0.1
            });
            const particle = new THREE.Mesh(particleGeom, particleMat);
            particle.position.z = -0.008 - i * 0.006;
            this.trail.add(particle);
        }
        this.group.add(this.trail);
    }

    updatePosition() {
        const lat = THREE.MathUtils.degToRad(this.latitude);
        const lon = THREE.MathUtils.degToRad(this.longitude);

        const r = this.earthRadius + 0.02;

        const x = r * Math.cos(lat) * Math.sin(lon);
        const y = r * Math.sin(lat);
        const z = r * Math.cos(lat) * Math.cos(lon);

        this.group.position.set(x, y, z);

        // Align to earth surface
        const up = new THREE.Vector3(x, y, z).normalize();
        const defaultUp = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(defaultUp, up);
        this.group.quaternion.copy(quaternion);

        // Apply direction
        this.group.rotateY(this.direction);
    }

    update(deltaTime) {
        if (!this.isActive) return;

        this.lifetime += deltaTime;

        // Move forward
        const moveAmount = this.speed * deltaTime;

        // Calculate movement based on direction
        const dirRad = this.direction;
        const latChange = Math.cos(dirRad) * moveAmount * 10;
        const lonChange = Math.sin(dirRad) * moveAmount * 10;

        this.latitude += latChange;
        this.longitude += lonChange;

        // Clamp latitude
        this.latitude = Math.max(-85, Math.min(85, this.latitude));

        // Wrap longitude
        if (this.longitude > 180) this.longitude -= 360;
        if (this.longitude < -180) this.longitude += 360;

        this.updatePosition();

        // Animate trail
        this.trail.children.forEach((particle, i) => {
            particle.position.z = -0.005 - i * 0.003 + Math.sin(this.lifetime * 20 + i) * 0.001;
        });

        // Check lifetime
        if (this.lifetime >= this.maxLifetime) {
            this.isActive = false;
        }
    }

    // Check hit against a position
    checkHit(lat, lon, hitRadius = 0.03) {
        const latDiff = Math.abs(this.latitude - lat);
        const lonDiff = Math.abs(this.longitude - lon);
        const adjustedLonDiff = Math.min(lonDiff, 360 - lonDiff);
        const distance = Math.sqrt(latDiff * latDiff + adjustedLonDiff * adjustedLonDiff);
        return distance < hitRadius * 100;
    }

    dispose() {
        this.isActive = false;
        this.group.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }
}

// Mine placed on ground
export class Mine {
    constructor(options = {}) {
        this.id = options.id || `mine_${Math.random().toString(36).substr(2, 9)}`;
        this.ownerId = options.ownerId;
        this.latitude = options.latitude || 0;
        this.longitude = options.longitude || 0;
        this.earthRadius = options.earthRadius || 1;
        this.triggerRadius = options.triggerRadius || 3; // degrees

        this.isActive = true;
        this.isExploding = false;
        this.explosionTime = 0;
        this.explosionDuration = 0.5;

        this.group = new THREE.Group();
        this.createVisual();
        this.updatePosition();
    }

    createVisual() {
        // Mine body (flat cylinder)
        const mineGeom = new THREE.CylinderGeometry(0.01, 0.012, 0.005, 16);
        const mineMat = new THREE.MeshToonMaterial({
            color: 0x424242
        });
        this.body = new THREE.Mesh(mineGeom, mineMat);
        this.body.position.y = 0.003;
        this.group.add(this.body);

        // Trigger button on top
        const buttonGeom = new THREE.CylinderGeometry(0.003, 0.003, 0.003, 8);
        const buttonMat = new THREE.MeshToonMaterial({ color: 0xf44336 });
        const button = new THREE.Mesh(buttonGeom, buttonMat);
        button.position.y = 0.004;
        this.body.add(button);

        // Warning stripes
        const stripeGeom = new THREE.BoxGeometry(0.02, 0.001, 0.002);
        const stripeMat = new THREE.MeshToonMaterial({ color: 0xffeb3b });
        for (let i = 0; i < 4; i++) {
            const stripe = new THREE.Mesh(stripeGeom, stripeMat);
            stripe.rotation.y = (i / 4) * Math.PI * 2;
            stripe.position.y = 0.006;
            this.body.add(stripe);
        }

        // Explosion effect (hidden initially)
        this.explosionGroup = new THREE.Group();
        this.explosionGroup.visible = false;

        const explosionGeom = new THREE.SphereGeometry(0.03, 16, 16);
        const explosionMat = new THREE.MeshBasicMaterial({
            color: 0xff5722,
            transparent: true,
            opacity: 0.8
        });
        this.explosionSphere = new THREE.Mesh(explosionGeom, explosionMat);
        this.explosionGroup.add(this.explosionSphere);

        this.group.add(this.explosionGroup);
    }

    updatePosition() {
        const lat = THREE.MathUtils.degToRad(this.latitude);
        const lon = THREE.MathUtils.degToRad(this.longitude);

        const r = this.earthRadius + 0.005;

        const x = r * Math.cos(lat) * Math.sin(lon);
        const y = r * Math.sin(lat);
        const z = r * Math.cos(lat) * Math.cos(lon);

        this.group.position.set(x, y, z);

        // Align to earth surface
        const up = new THREE.Vector3(x, y, z).normalize();
        const defaultUp = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(defaultUp, up);
        this.group.quaternion.copy(quaternion);
    }

    update(deltaTime) {
        if (this.isExploding) {
            this.explosionTime += deltaTime;

            // Explosion animation
            const progress = this.explosionTime / this.explosionDuration;
            const scale = 1 + progress * 3;
            this.explosionSphere.scale.setScalar(scale);
            this.explosionSphere.material.opacity = 0.8 * (1 - progress);

            if (this.explosionTime >= this.explosionDuration) {
                this.isActive = false;
                this.group.visible = false;
            }
        }
    }

    // Check if position triggers the mine
    checkTrigger(lat, lon) {
        if (!this.isActive || this.isExploding) return false;

        const latDiff = Math.abs(this.latitude - lat);
        const lonDiff = Math.abs(this.longitude - lon);
        const adjustedLonDiff = Math.min(lonDiff, 360 - lonDiff);
        const distance = Math.sqrt(latDiff * latDiff + adjustedLonDiff * adjustedLonDiff);

        return distance < this.triggerRadius;
    }

    explode() {
        if (this.isExploding) return;

        this.isExploding = true;
        this.explosionTime = 0;
        this.body.visible = false;
        this.explosionGroup.visible = true;
    }

    dispose() {
        this.isActive = false;
        this.group.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }
}

// Export item manager class
export class ItemManager {
    constructor(options = {}) {
        this.scene = options.scene;
        this.earthRadius = options.earthRadius || 1;
        this.isLandAt = options.isLandAt || (() => true);

        this.itemBoxes = new Map();
        this.missiles = new Map();
        this.mines = new Map();

        this.spawnInterval = 10000; // 10 seconds
        this.lastSpawnTime = 0;
    }

    // Spawn items based on player count
    spawnItems(playerCount) {
        const itemCount = Math.floor(playerCount / 2);
        if (itemCount <= 0) return [];

        const spawnedItems = [];

        for (let i = 0; i < itemCount; i++) {
            // Find random land position
            let attempts = 0;
            let lat, lon;

            do {
                lat = (Math.random() - 0.5) * 140; // -70 to 70
                lon = (Math.random() - 0.5) * 360; // -180 to 180
                attempts++;
            } while (!this.isLandAt(lat, lon) && attempts < 50);

            if (attempts >= 50) continue; // Skip if no land found

            const itemBox = new ItemBox({
                latitude: lat,
                longitude: lon,
                earthRadius: this.earthRadius
            });

            this.itemBoxes.set(itemBox.id, itemBox);
            if (this.scene) {
                this.scene.add(itemBox.group);
            }

            spawnedItems.push({
                id: itemBox.id,
                itemType: itemBox.itemType,
                latitude: lat,
                longitude: lon
            });
        }

        return spawnedItems;
    }

    // Add item box from server
    addItemBox(data) {
        // 육지 체크 - 바다에 있으면 추가하지 않음
        if (!this.isLandAt(data.latitude, data.longitude)) {
            console.log(`Item ${data.id} is on water, skipping`);
            return null;
        }

        const itemBox = new ItemBox({
            id: data.id,
            itemType: data.itemType,
            latitude: data.latitude,
            longitude: data.longitude,
            earthRadius: this.earthRadius
        });

        this.itemBoxes.set(itemBox.id, itemBox);
        if (this.scene) {
            this.scene.add(itemBox.group);
        }

        return itemBox;
    }

    // Remove item box
    removeItemBox(id) {
        const itemBox = this.itemBoxes.get(id);
        if (itemBox) {
            if (this.scene) {
                this.scene.remove(itemBox.group);
            }
            itemBox.dispose();
            this.itemBoxes.delete(id);
        }
    }

    // Check for pickup
    checkPickup(lat, lon) {
        for (const [id, itemBox] of this.itemBoxes) {
            if (!itemBox.isCollected && itemBox.canPickup(lat, lon)) {
                return itemBox;
            }
        }
        return null;
    }

    // Create missile
    createMissile(options) {
        const missile = new Missile({
            ...options,
            earthRadius: this.earthRadius
        });

        this.missiles.set(missile.id, missile);
        if (this.scene) {
            this.scene.add(missile.group);
        }

        return missile;
    }

    // Remove missile
    removeMissile(id) {
        const missile = this.missiles.get(id);
        if (missile) {
            if (this.scene) {
                this.scene.remove(missile.group);
            }
            missile.dispose();
            this.missiles.delete(id);
        }
    }

    // Create mine
    createMine(options) {
        const mine = new Mine({
            ...options,
            earthRadius: this.earthRadius
        });

        this.mines.set(mine.id, mine);
        if (this.scene) {
            this.scene.add(mine.group);
        }

        return mine;
    }

    // Remove mine
    removeMine(id) {
        const mine = this.mines.get(id);
        if (mine) {
            if (this.scene) {
                this.scene.remove(mine.group);
            }
            mine.dispose();
            this.mines.delete(id);
        }
    }

    // Check mine triggers
    checkMineTrigger(lat, lon) {
        for (const [id, mine] of this.mines) {
            if (mine.checkTrigger(lat, lon)) {
                return mine;
            }
        }
        return null;
    }

    // Update all items
    update(deltaTime) {
        // Update item boxes
        this.itemBoxes.forEach(itemBox => {
            itemBox.update(deltaTime);
        });

        // Update missiles
        const expiredMissiles = [];
        this.missiles.forEach((missile, id) => {
            missile.update(deltaTime);
            if (!missile.isActive) {
                expiredMissiles.push(id);
            }
        });
        expiredMissiles.forEach(id => this.removeMissile(id));

        // Update mines
        const expiredMines = [];
        this.mines.forEach((mine, id) => {
            mine.update(deltaTime);
            if (!mine.isActive) {
                expiredMines.push(id);
            }
        });
        expiredMines.forEach(id => this.removeMine(id));
    }

    // Clear all items
    clear() {
        this.itemBoxes.forEach((itemBox, id) => {
            if (this.scene) {
                this.scene.remove(itemBox.group);
            }
            itemBox.dispose();
        });
        this.itemBoxes.clear();

        this.missiles.forEach((missile, id) => {
            if (this.scene) {
                this.scene.remove(missile.group);
            }
            missile.dispose();
        });
        this.missiles.clear();

        this.mines.forEach((mine, id) => {
            if (this.scene) {
                this.scene.remove(mine.group);
            }
            mine.dispose();
        });
        this.mines.clear();
    }
}

import * as THREE from 'three';

export class Character {
    constructor() {
        this.group = new THREE.Group();
        this.animationTime = 0;
        this.isWalking = false;
        this.walkSpeed = 0.015;

        // 구면 좌표 (위도, 경도)
        this.latitude = 0;
        this.longitude = 0;
        this.earthRadius = 1;
        this.characterHeight = 0.08;

        this.createCharacter();
        this.updatePositionOnEarth();
    }

    createCharacter() {
        const white = 0xffffff;
        const black = 0x222222;
        const cherry = 0xe63946;
        const yellow = 0xf4e285;

        // === 몸통 ===
        const bodyGeom = new THREE.SphereGeometry(0.022, 16, 16);
        bodyGeom.scale(1, 1.1, 0.9);
        const bodyMat = new THREE.MeshToonMaterial({ color: white });
        this.body = new THREE.Mesh(bodyGeom, bodyMat);
        this.body.position.y = 0.025;
        this.group.add(this.body);

        // === 머리 ===
        const headGeom = new THREE.SphereGeometry(0.02, 16, 16);
        headGeom.scale(1.1, 1, 1);
        const headMat = new THREE.MeshToonMaterial({ color: white });
        this.head = new THREE.Mesh(headGeom, headMat);
        this.head.position.y = 0.058;
        this.group.add(this.head);

        // === 귀 (왼쪽) ===
        const earGeom = new THREE.ConeGeometry(0.008, 0.018, 4);
        const earMat = new THREE.MeshToonMaterial({ color: white });

        this.leftEar = new THREE.Mesh(earGeom, earMat);
        this.leftEar.position.set(-0.012, 0.075, 0);
        this.leftEar.rotation.z = 0.3;
        this.group.add(this.leftEar);

        // === 귀 (오른쪽) ===
        this.rightEar = new THREE.Mesh(earGeom, earMat);
        this.rightEar.position.set(0.012, 0.075, 0);
        this.rightEar.rotation.z = -0.3;
        this.group.add(this.rightEar);

        // === 체리 ===
        const cherryGeom = new THREE.SphereGeometry(0.007, 12, 12);
        const cherryMat = new THREE.MeshToonMaterial({ color: cherry });
        this.cherry = new THREE.Mesh(cherryGeom, cherryMat);
        this.cherry.position.set(0, 0.078, 0);
        this.group.add(this.cherry);

        // === 체리 줄기 ===
        const stemGeom = new THREE.CylinderGeometry(0.001, 0.001, 0.015, 8);
        const stemMat = new THREE.MeshToonMaterial({ color: black });
        this.stem = new THREE.Mesh(stemGeom, stemMat);
        this.stem.position.set(0, 0.09, 0);
        this.stem.rotation.z = 0.2;
        this.group.add(this.stem);

        // === 눈 (왼쪽) - 찡그린 눈 ===
        const eyeGroup = new THREE.Group();

        // 왼쪽 눈
        const leftEyeGeom = new THREE.BoxGeometry(0.006, 0.003, 0.002);
        const eyeMat = new THREE.MeshToonMaterial({ color: black });
        this.leftEye = new THREE.Mesh(leftEyeGeom, eyeMat);
        this.leftEye.position.set(-0.007, 0.06, 0.018);
        this.leftEye.rotation.z = -0.3;
        this.group.add(this.leftEye);

        // 오른쪽 눈
        this.rightEye = new THREE.Mesh(leftEyeGeom, eyeMat);
        this.rightEye.position.set(0.007, 0.06, 0.018);
        this.rightEye.rotation.z = 0.3;
        this.group.add(this.rightEye);

        // === 입 (노란 이빨) ===
        const mouthGeom = new THREE.BoxGeometry(0.012, 0.006, 0.002);
        const mouthMat = new THREE.MeshToonMaterial({ color: yellow });
        this.mouth = new THREE.Mesh(mouthGeom, mouthMat);
        this.mouth.position.set(0, 0.048, 0.018);
        this.group.add(this.mouth);

        // 이빨 디테일 (가운데 선)
        const toothLineGeom = new THREE.BoxGeometry(0.001, 0.006, 0.003);
        const toothLineMat = new THREE.MeshToonMaterial({ color: 0xdddddd });
        const toothLine = new THREE.Mesh(toothLineGeom, toothLineMat);
        toothLine.position.set(0, 0.048, 0.019);
        this.group.add(toothLine);

        // === 볼 터치 (수염 자국) ===
        const blushGeom = new THREE.CircleGeometry(0.003, 8);
        const blushMat = new THREE.MeshToonMaterial({ color: 0xffcccc, side: THREE.DoubleSide });

        const leftBlush = new THREE.Mesh(blushGeom, blushMat);
        leftBlush.position.set(-0.015, 0.052, 0.016);
        leftBlush.rotation.y = 0.3;
        this.group.add(leftBlush);

        const rightBlush = new THREE.Mesh(blushGeom, blushMat);
        rightBlush.position.set(0.015, 0.052, 0.016);
        rightBlush.rotation.y = -0.3;
        this.group.add(rightBlush);

        // === 팔 ===
        const armGeom = new THREE.CapsuleGeometry(0.005, 0.015, 4, 8);
        const armMat = new THREE.MeshToonMaterial({ color: white });

        // 왼팔
        this.leftArm = new THREE.Mesh(armGeom, armMat);
        this.leftArm.position.set(-0.028, 0.028, 0);
        this.group.add(this.leftArm);

        // 오른팔
        this.rightArm = new THREE.Mesh(armGeom, armMat);
        this.rightArm.position.set(0.028, 0.028, 0);
        this.group.add(this.rightArm);

        // === 손 ===
        const handGeom = new THREE.SphereGeometry(0.006, 8, 8);
        handGeom.scale(1, 0.6, 1);
        const handMat = new THREE.MeshToonMaterial({ color: white });

        this.leftHand = new THREE.Mesh(handGeom, handMat);
        this.leftHand.position.set(-0.028, 0.012, 0);
        this.group.add(this.leftHand);

        this.rightHand = new THREE.Mesh(handGeom, handMat);
        this.rightHand.position.set(0.028, 0.012, 0);
        this.group.add(this.rightHand);

        // === 다리 ===
        const legGeom = new THREE.CylinderGeometry(0.005, 0.006, 0.018, 8);
        const legMat = new THREE.MeshToonMaterial({ color: black });

        // 왼다리
        this.leftLeg = new THREE.Mesh(legGeom, legMat);
        this.leftLeg.position.set(-0.01, 0.005, 0);
        this.group.add(this.leftLeg);

        // 오른다리
        this.rightLeg = new THREE.Mesh(legGeom, legMat);
        this.rightLeg.position.set(0.01, 0.005, 0);
        this.group.add(this.rightLeg);

        // === 발 ===
        const footGeom = new THREE.SphereGeometry(0.007, 8, 8);
        footGeom.scale(1.2, 0.5, 1.5);
        const footMat = new THREE.MeshToonMaterial({ color: black });

        this.leftFoot = new THREE.Mesh(footGeom, footMat);
        this.leftFoot.position.set(-0.01, -0.005, 0.003);
        this.group.add(this.leftFoot);

        this.rightFoot = new THREE.Mesh(footGeom, footMat);
        this.rightFoot.position.set(0.01, -0.005, 0.003);
        this.group.add(this.rightFoot);

        // 그림자 설정
        this.group.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
    }

    // 걷기 애니메이션
    animateWalk(deltaTime) {
        if (!this.isWalking) {
            // 대기 상태 - 부드럽게 원래 위치로
            this.animationTime *= 0.9;
        } else {
            this.animationTime += deltaTime * 10;
        }

        const t = this.animationTime;
        const walkCycle = Math.sin(t);
        const walkCycle2 = Math.cos(t);

        // 다리 애니메이션
        this.leftLeg.rotation.x = walkCycle * 0.5;
        this.rightLeg.rotation.x = -walkCycle * 0.5;

        this.leftFoot.position.z = 0.003 + walkCycle * 0.008;
        this.rightFoot.position.z = 0.003 - walkCycle * 0.008;

        // 팔 애니메이션 (다리와 반대)
        this.leftArm.rotation.x = -walkCycle * 0.4;
        this.rightArm.rotation.x = walkCycle * 0.4;

        this.leftHand.position.z = -walkCycle * 0.005;
        this.rightHand.position.z = walkCycle * 0.005;

        // 몸통 약간 흔들림
        this.body.rotation.z = walkCycle2 * 0.05;
        this.body.position.y = 0.025 + Math.abs(walkCycle) * 0.003;

        // 머리도 약간
        this.head.rotation.z = walkCycle2 * 0.03;
        this.head.position.y = 0.058 + Math.abs(walkCycle) * 0.002;

        // 체리 흔들림
        this.cherry.position.x = walkCycle2 * 0.002;
        this.stem.rotation.z = 0.2 + walkCycle2 * 0.1;
    }

    // 지구 표면 위치 업데이트
    updatePositionOnEarth() {
        const lat = THREE.MathUtils.degToRad(this.latitude);
        const lon = THREE.MathUtils.degToRad(this.longitude);

        const r = this.earthRadius + this.characterHeight;

        // 구면 좌표 -> 직교 좌표
        const x = r * Math.cos(lat) * Math.sin(lon);
        const y = r * Math.sin(lat);
        const z = r * Math.cos(lat) * Math.cos(lon);

        this.group.position.set(x, y, z);

        // 캐릭터가 지구 표면에 수직으로 서도록 회전
        const up = new THREE.Vector3(x, y, z).normalize();
        const defaultUp = new THREE.Vector3(0, 1, 0);

        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(defaultUp, up);
        this.group.quaternion.copy(quaternion);

        // 이동 방향으로 캐릭터 회전
        this.group.rotateY(-lon + Math.PI);
    }

    // 이동 함수들
    moveForward() {
        this.latitude += this.walkSpeed * Math.cos(THREE.MathUtils.degToRad(this.longitude));
        this.longitude += this.walkSpeed * Math.sin(THREE.MathUtils.degToRad(this.longitude)) / Math.cos(THREE.MathUtils.degToRad(this.latitude));
        this.latitude = Math.max(-89, Math.min(89, this.latitude));
        this.isWalking = true;
        this.updatePositionOnEarth();
    }

    moveBackward() {
        this.latitude -= this.walkSpeed * Math.cos(THREE.MathUtils.degToRad(this.longitude));
        this.longitude -= this.walkSpeed * Math.sin(THREE.MathUtils.degToRad(this.longitude)) / Math.cos(THREE.MathUtils.degToRad(this.latitude));
        this.latitude = Math.max(-89, Math.min(89, this.latitude));
        this.isWalking = true;
        this.updatePositionOnEarth();
    }

    moveLeft() {
        this.longitude -= this.walkSpeed * 2;
        this.isWalking = true;
        this.group.rotateY(0.05);
        this.updatePositionOnEarth();
    }

    moveRight() {
        this.longitude += this.walkSpeed * 2;
        this.isWalking = true;
        this.group.rotateY(-0.05);
        this.updatePositionOnEarth();
    }

    stopWalking() {
        this.isWalking = false;
    }

    // 특정 위치로 이동
    setPosition(lat, lon) {
        this.latitude = lat;
        this.longitude = lon;
        this.updatePositionOnEarth();
    }

    update(deltaTime) {
        this.animateWalk(deltaTime);
    }
}

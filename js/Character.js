import * as THREE from 'three';

export class Character {
    constructor(options = {}) {
        this.group = new THREE.Group();
        this.animationTime = 0;
        this.isWalking = false;
        this.isRunning = false;

        // 플레이어 식별
        this.playerId = options.playerId || null;
        this.isRemote = options.isRemote || false; // 리모트 플레이어 여부
        this.playerColor = options.color || null; // 플레이어 색상 (HSL string)

        // 속도 설정
        this.walkSpeed = 0.3;
        this.runSpeed = 0.8;
        this.turnSpeed = 2.0;

        // 구면 좌표 (위도, 경도)
        this.latitude = 0;
        this.longitude = 0;
        this.facingAngle = 0; // 캐릭터가 바라보는 방향 (라디안)

        this.earthRadius = 1;
        this.characterHeight = 0.01;
        this.baseHeight = 0.01;

        // 점프 관련
        this.isJumping = false;
        this.jumpVelocity = 0;
        this.jumpForce = 0.8;
        this.gravity = 2.5;

        // 점프 시작 위치 저장 (물에 빠졌을 때 복귀용)
        this.lastJumpLat = 0;
        this.lastJumpLon = 0;

        // 물에 빠짐 상태
        this.isDrowning = false;
        this.drowningTime = 0;
        this.drowningDuration = 1.0; // 1초간 빠지는 애니메이션

        // 스턴 상태
        this.isStunned = false;
        this.stunTime = 0;
        this.stunDuration = 5.0; // 기본 5초 (외부에서 설정 가능)
        this.stunStars = []; // 별 오브젝트들

        // 육지 체크 함수 (외부에서 설정)
        this.landCheckFn = null;

        // 리모트 플레이어용 보간 (interpolation)
        this.targetLatitude = 0;
        this.targetLongitude = 0;
        this.targetFacingAngle = 0;
        this.interpolationSpeed = 10; // 보간 속도

        this.createCharacter();
        this.updatePositionOnEarth();
    }

    // HSL 문자열을 THREE.js 색상으로 변환
    parseHSLColor(hslString) {
        if (!hslString) return null;
        const match = hslString.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
        if (match) {
            const h = parseInt(match[1]) / 360;
            const s = parseInt(match[2]) / 100;
            const l = parseInt(match[3]) / 100;
            const color = new THREE.Color();
            color.setHSL(h, s, l);
            return color.getHex();
        }
        return null;
    }

    createCharacter() {
        const white = 0xffffff;
        const black = 0x222222;
        const cherry = 0xe63946;
        const yellow = 0xf4e285;

        // 플레이어 색상이 있으면 해당 색상 사용
        const bodyColor = this.parseHSLColor(this.playerColor) || white;

        // === 몸통 ===
        const bodyGeom = new THREE.SphereGeometry(0.022, 16, 16);
        bodyGeom.scale(1, 1.1, 0.9);
        const bodyMat = new THREE.MeshToonMaterial({ color: bodyColor });
        this.body = new THREE.Mesh(bodyGeom, bodyMat);
        this.body.position.y = 0.025;
        this.group.add(this.body);

        // === 머리 ===
        const headGeom = new THREE.SphereGeometry(0.02, 16, 16);
        headGeom.scale(1.1, 1, 1);
        const headMat = new THREE.MeshToonMaterial({ color: bodyColor });
        this.head = new THREE.Mesh(headGeom, headMat);
        this.head.position.y = 0.058;
        this.group.add(this.head);

        // === 귀 (왼쪽) ===
        const earGeom = new THREE.ConeGeometry(0.008, 0.018, 4);
        const earMat = new THREE.MeshToonMaterial({ color: bodyColor });

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
        const armMat = new THREE.MeshToonMaterial({ color: bodyColor });

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
        const handMat = new THREE.MeshToonMaterial({ color: bodyColor });

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

        // === 스턴 별 (머리 위에서 회전) ===
        this.createStunStars();
    }

    // 스턴 별 생성
    createStunStars() {
        const starColor = 0xffdd00; // 노란색
        const starCount = 3;
        const starRadius = 0.04; // 별이 회전하는 반지름

        // 별 그룹 (머리 위에 위치)
        this.stunStarsGroup = new THREE.Group();
        this.stunStarsGroup.position.y = 0.095; // 머리 위
        this.stunStarsGroup.visible = false; // 초기에는 숨김
        this.group.add(this.stunStarsGroup);

        for (let i = 0; i < starCount; i++) {
            // 별 모양 (4개 꼭지점)
            const starGeom = new THREE.OctahedronGeometry(0.006, 0);
            starGeom.scale(1, 0.6, 1);
            const starMat = new THREE.MeshToonMaterial({
                color: starColor,
                emissive: starColor,
                emissiveIntensity: 0.3
            });
            const star = new THREE.Mesh(starGeom, starMat);

            // 원형으로 배치
            const angle = (i / starCount) * Math.PI * 2;
            star.position.x = Math.cos(angle) * starRadius;
            star.position.z = Math.sin(angle) * starRadius;
            star.position.y = 0;

            this.stunStarsGroup.add(star);
            this.stunStars.push(star);
        }
    }

    // 걷기/달리기 애니메이션
    animateWalk(deltaTime) {
        const animSpeed = this.isRunning ? 18 : 10;
        const animIntensity = this.isRunning ? 1.3 : 1.0;

        if (!this.isWalking) {
            // 대기 상태 - 부드럽게 원래 위치로
            this.animationTime *= 0.9;
        } else {
            this.animationTime += deltaTime * animSpeed;
        }

        const t = this.animationTime;
        const walkCycle = Math.sin(t) * animIntensity;
        const walkCycle2 = Math.cos(t) * animIntensity;

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

        // 캐릭터가 바라보는 방향으로 회전
        this.group.rotateY(this.facingAngle);
    }

    // W: 앞으로 이동 (바라보는 방향)
    moveForward(deltaTime) {
        const speed = this.isRunning ? this.runSpeed : this.walkSpeed;
        const moveAmount = speed * deltaTime;

        // 캐릭터의 앞쪽 방향 벡터 (로컬 +Z를 월드 좌표로 변환)
        // 캐릭터 얼굴이 +Z 방향에 있음
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion);

        // 현재 위치에서 앞쪽 방향으로 이동
        const currentPos = this.group.position.clone();
        const newPos = currentPos.add(forward.multiplyScalar(moveAmount));

        // 새 위치를 구면 좌표로 변환
        const r = newPos.length();
        const newLat = Math.asin(newPos.y / r) * (180 / Math.PI);
        const newLon = Math.atan2(newPos.x, newPos.z) * (180 / Math.PI);

        const clampedLat = Math.max(-85, Math.min(85, newLat));

        // 육지 체크: 점프 중이 아니고 바다면 이동 불가
        if (this.landCheckFn && !this.isJumping) {
            if (!this.landCheckFn(clampedLat, newLon)) {
                // 바다입니다 - 이동 불가, 걷기 애니메이션만
                this.isWalking = true;
                return;
            }
        }

        this.latitude = clampedLat;
        this.longitude = newLon;
        this.isWalking = true;
        this.updatePositionOnEarth();
    }

    // S: 뒤돌아보기 (빠르게 180도 회전)
    turnAround(deltaTime) {
        // 목표 각도 (현재 + 180도)
        if (!this.turningAround) {
            this.turningAround = true;
            this.targetAngle = this.facingAngle + Math.PI;
        }

        const turnSpeed = this.turnSpeed * 5; // 빠른 회전
        const diff = this.targetAngle - this.facingAngle;

        if (Math.abs(diff) > 0.05) {
            this.facingAngle += Math.sign(diff) * turnSpeed * deltaTime;
        } else {
            this.facingAngle = this.targetAngle;
            this.turningAround = false;
        }

        // 각도 정규화
        while (this.facingAngle > Math.PI * 2) this.facingAngle -= Math.PI * 2;
        while (this.facingAngle < 0) this.facingAngle += Math.PI * 2;

        this.updatePositionOnEarth();
    }

    // A: 왼쪽으로 방향 전환
    turnLeft(deltaTime) {
        this.facingAngle += this.turnSpeed * deltaTime;
        this.turningAround = false; // S키 회전 취소
        this.updatePositionOnEarth();
    }

    // D: 오른쪽으로 방향 전환
    turnRight(deltaTime) {
        this.facingAngle -= this.turnSpeed * deltaTime;
        this.turningAround = false; // S키 회전 취소
        this.updatePositionOnEarth();
    }

    // Shift: 달리기 모드
    setRunning(running) {
        this.isRunning = running;
    }

    // Space: 점프
    jump() {
        if (!this.isJumping && !this.isDrowning) {
            // 점프 시작 위치 저장
            this.lastJumpLat = this.latitude;
            this.lastJumpLon = this.longitude;

            this.isJumping = true;
            this.jumpVelocity = this.jumpForce;
        }
    }

    // 점프 업데이트
    updateJump(deltaTime) {
        if (this.isJumping) {
            // 속도에 따른 높이 변화
            this.characterHeight += this.jumpVelocity * deltaTime;
            // 중력 적용
            this.jumpVelocity -= this.gravity * deltaTime;

            // 땅에 착지
            if (this.characterHeight <= this.baseHeight) {
                this.characterHeight = this.baseHeight;
                this.isJumping = false;
                this.jumpVelocity = 0;

                // 착지 위치가 물인지 확인
                if (this.landCheckFn && !this.landCheckFn(this.latitude, this.longitude)) {
                    // 물에 빠짐!
                    this.isDrowning = true;
                    this.drowningTime = 0;
                }
            }

            this.updatePositionOnEarth();
        }
    }

    // 물에 빠지는 애니메이션 업데이트
    updateDrowning(deltaTime) {
        if (this.isDrowning) {
            this.drowningTime += deltaTime;

            // 물에 가라앉는 효과
            const sinkAmount = (this.drowningTime / this.drowningDuration) * 0.1;
            this.characterHeight = this.baseHeight - sinkAmount;
            this.updatePositionOnEarth();

            // 애니메이션 완료 후 복귀
            if (this.drowningTime >= this.drowningDuration) {
                this.isDrowning = false;
                this.characterHeight = this.baseHeight;
                this.latitude = this.lastJumpLat;
                this.longitude = this.lastJumpLon;
                this.updatePositionOnEarth();
            }
        }
    }

    // 스턴 시작
    applyStun(duration = null) {
        if (this.isDrowning) return; // 물에 빠진 동안에는 스턴 불가

        this.isStunned = true;
        this.stunTime = 0;
        if (duration !== null) {
            this.stunDuration = duration;
        }

        // 별 표시
        if (this.stunStarsGroup) {
            this.stunStarsGroup.visible = true;
        }

        console.log(`Character stunned for ${this.stunDuration} seconds`);
    }

    // 스턴 해제
    removeStun() {
        this.isStunned = false;
        this.stunTime = 0;

        // 별 숨기기
        if (this.stunStarsGroup) {
            this.stunStarsGroup.visible = false;
        }

        // 몸 원래 위치로
        if (this.body) {
            this.body.position.y = 0.025;
            this.body.rotation.x = 0;
        }
        if (this.head) {
            this.head.position.y = 0.058;
        }
        if (this.leftArm) {
            this.leftArm.rotation.x = 0;
            this.leftArm.rotation.z = 0;
        }
        if (this.rightArm) {
            this.rightArm.rotation.x = 0;
            this.rightArm.rotation.z = 0;
        }
    }

    // 스턴 애니메이션 업데이트
    updateStun(deltaTime) {
        if (!this.isStunned) return;

        this.stunTime += deltaTime;

        // 주저앉는 포즈
        const sitAmount = Math.min(this.stunTime * 3, 1); // 빠르게 주저앉기

        // 몸통 아래로 + 약간 앞으로 기울임
        if (this.body) {
            this.body.position.y = 0.025 - sitAmount * 0.012;
            this.body.rotation.x = sitAmount * 0.3;
        }

        // 머리도 살짝 아래로
        if (this.head) {
            this.head.position.y = 0.058 - sitAmount * 0.008;
        }

        // 팔 축 늘어뜨림
        if (this.leftArm) {
            this.leftArm.rotation.x = sitAmount * 0.5;
            this.leftArm.rotation.z = sitAmount * 0.3;
        }
        if (this.rightArm) {
            this.rightArm.rotation.x = sitAmount * 0.5;
            this.rightArm.rotation.z = -sitAmount * 0.3;
        }

        // 별 회전 애니메이션
        if (this.stunStarsGroup) {
            this.stunStarsGroup.rotation.y += deltaTime * 5; // 초당 5라디안 회전

            // 별들 위아래로 흔들림
            this.stunStars.forEach((star, i) => {
                const phase = (i / this.stunStars.length) * Math.PI * 2;
                star.position.y = Math.sin(this.stunTime * 4 + phase) * 0.005;
                star.rotation.y += deltaTime * 3; // 개별 회전
            });
        }

        // 스턴 종료
        if (this.stunTime >= this.stunDuration) {
            this.removeStun();
        }
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
        // 스턴 중이 아닐 때만 걷기 애니메이션
        if (!this.isStunned) {
            this.animateWalk(deltaTime);
        }
        this.updateJump(deltaTime);
        this.updateDrowning(deltaTime);
        this.updateStun(deltaTime);

        // 리모트 플레이어는 보간 적용
        if (this.isRemote) {
            this.updateInterpolation(deltaTime);
        }
    }

    // 리모트 플레이어용 보간 업데이트
    updateInterpolation(deltaTime) {
        const t = this.interpolationSpeed * deltaTime;

        // 위도/경도 보간
        this.latitude += (this.targetLatitude - this.latitude) * t;
        this.longitude += (this.targetLongitude - this.longitude) * t;

        // 방향 보간 (각도 차이 처리)
        let angleDiff = this.targetFacingAngle - this.facingAngle;
        // 각도 차이를 -PI ~ PI 범위로 정규화
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        this.facingAngle += angleDiff * t;

        this.updatePositionOnEarth();
    }

    // 리모트 플레이어 상태 업데이트 (서버에서 받은 데이터)
    setRemoteState(state) {
        this.targetLatitude = state.latitude;
        this.targetLongitude = state.longitude;
        this.targetFacingAngle = state.facingAngle;
        this.isWalking = state.isWalking || false;
        this.isRunning = state.isRunning || false;
        this.isJumping = state.isJumping || false;
        this.isDrowning = state.isDrowning || false;

        // 스턴 상태 처리
        if (state.isStunned && !this.isStunned) {
            this.applyStun(state.stunDuration || this.stunDuration);
        } else if (!state.isStunned && this.isStunned) {
            this.removeStun();
        }
    }

    // 캐릭터 색상 업데이트
    updateColor(hslString) {
        this.playerColor = hslString;
        const bodyColor = this.parseHSLColor(hslString);
        if (bodyColor !== null) {
            // body, head, ears, arms, hands 색상 업데이트
            if (this.body) this.body.material.color.setHex(bodyColor);
            if (this.head) this.head.material.color.setHex(bodyColor);
            if (this.leftEar) this.leftEar.material.color.setHex(bodyColor);
            if (this.rightEar) this.rightEar.material.color.setHex(bodyColor);
            if (this.leftArm) this.leftArm.material.color.setHex(bodyColor);
            if (this.rightArm) this.rightArm.material.color.setHex(bodyColor);
            if (this.leftHand) this.leftHand.material.color.setHex(bodyColor);
            if (this.rightHand) this.rightHand.material.color.setHex(bodyColor);
        }
    }

    // 캐릭터 제거
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

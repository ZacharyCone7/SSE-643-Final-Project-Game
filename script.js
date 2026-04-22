import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// --------------------------------------------------------
// 1. SCENE & GLOBAL CONFIGURATION
// --------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020202);
scene.fog = new THREE.FogExp2(0x020202, 0.04); // Adds spooky darkness

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.8, -2); // Start at center (campfire)
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const clock = new THREE.Clock();

// Game State
let isPlaying = false;
let health = 100;
let score = 0;
const activeZombies = [];
const mixers = [];

let zombie1Template = null;
let zombie2Template = null; // Add this!
let woodenbatTemplate = null;
let zombie1Animations = [];
let zombie2Animations = []; // Add this!
let woodenbatAnimations = []; // Add this!

const targetHitboxes = [];
let walkTime = 0; // For walking motion
const dyingZombies = []; 
let isSwinging = false;
let swingTimer = 0;
const batBasePos = new THREE.Vector3(0.5, -0.6, -1.0); // Position relative to camera
const batBaseRot = new THREE.Euler(10.8, 0, 0);       // Default resting rotation


// UI Elements
const instructions = document.getElementById('instructions');
const menus = document.getElementById('menus');
const gameOverScreen = document.getElementById('game-over');
const healthDisplay = document.getElementById('health-display');
const scoreDisplay = document.getElementById('score-display');
const finalScoreDisplay = document.getElementById('final-score');

// --------------------------------------------------------
// ENVIRONMENT: CAMPFIRE & TREES
// --------------------------------------------------------
// Simple Ground
const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1.0 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const fireLight = new THREE.PointLight(0xff6600, 10, 20);
fireLight.position.set(0, 1, 0); // Directly above the logs
fireLight.castShadow = true;
scene.add(fireLight);

const ambientLight = new THREE.AmbientLight(0x404040, 0.5); // Soft moonlight
scene.add(ambientLight);

function createStarfield(numStars) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(numStars * 3);
    for (let i = 0; i < numStars; i++) {
        const r = 150 + Math.random() * 50;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.7, transparent: true, opacity: 0.8, sizeAttenuation: true, fog: false}));
}

const stars = createStarfield(2000);
scene.add(stars);

let fireShaderMaterial; 
let sparkMaterial;
let fireIntensity = 0.5;

function createCampfire() {
    const campfireGroup = new THREE.Group();

    // 1. The Logs (No shadows casting on themselves)
    const logMaterial = new THREE.MeshStandardMaterial({ color: 0x3d1c04, roughness: 1.0 });
    const logGeometry = new THREE.CylinderGeometry(0.15, 0.15, 1.5, 8);
    for (let i = 0; i < 6; i++) {
        const log = new THREE.Mesh(logGeometry, logMaterial);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = (Math.PI / 3) * i;
        log.position.y = 0.1;
        log.receiveShadow = true;
        campfireGroup.add(log);
    }

    // 2. Glowing Embers Base
    const emberGeo = new THREE.SphereGeometry(0.5, 8, 8);
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xff3300, fog: false });
    const embers = new THREE.Mesh(emberGeo, emberMat);
    embers.position.y = 0.1;
    embers.scale.y = 0.3; 
    campfireGroup.add(embers);

    // 3. The Volumetric Fire Shader (REPLACED SECTION)
    const fireGeo = new THREE.CylinderGeometry(0.1, 0.6, 2.0, 16, 16, true);
    fireGeo.translate(0, 1.0, 0); // Shift origin to the bottom

    fireShaderMaterial = new THREE.ShaderMaterial({
        uniforms: { 
            uTime: { value: 0.0 } 
        },
        vertexShader: `
            varying vec2 vUv;
            varying float vHeight;

            void main() {
                vUv = uv;
                vHeight = position.y / 2.0; 
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            varying vec2 vUv;
            varying float vHeight;

            float rand(vec2 n) { 
                return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
            }
            
            float noise(vec2 p){
                vec2 ip = floor(p);
                vec2 u = fract(p);
                u = u*u*(3.0-2.0*u);
                float res = mix(
                    mix(rand(ip),rand(ip+vec2(1.0,0.0)),u.x),
                    mix(rand(ip+vec2(0.0,1.0)),rand(ip+vec2(1.0,1.0)),u.x),u.y);
                return res*res;
            }

            void main() {
                vec2 scrolledUv = vec2(vUv.x * 3.0, vUv.y - uTime * 1.5);
                
                float n = noise(scrolledUv * 4.0);
                n += noise(scrolledUv * 8.0) * 0.5;
                n += noise(scrolledUv * 16.0) * 0.25;
                
                float mask = (1.0 - vHeight) * 1.5; 
                float fireAlpha = smoothstep(0.4, 0.6, n * mask);

                vec3 baseColor = vec3(1.0, 0.9, 0.1); 
                vec3 midColor = vec3(1.0, 0.4, 0.0);
                vec3 tipColor = vec3(0.8, 0.0, 0.0);
                
                vec3 finalColor = mix(baseColor, midColor, vHeight * 1.5);
                finalColor = mix(finalColor, tipColor, vHeight * 2.0);

                if (fireAlpha <= 0.05) discard;

                gl_FragColor = vec4(finalColor, fireAlpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false, 
        side: THREE.DoubleSide 
    });

    const fireMesh = new THREE.Mesh(fireGeo, fireShaderMaterial);
    fireMesh.position.y = 0.1;
    campfireGroup.add(fireMesh);

    // 4. Dynamic Flying Sparks
    const maxSparks = 500; // Over-allocate for the "maximum" possible fire
    const sparkPositions = new Float32Array(maxSparks * 3);
    const sparkRandoms = new Float32Array(maxSparks);

    for (let i = 0; i < maxSparks; i++) {
        sparkPositions[i * 3] = (Math.random() - 0.5) * 0.5;
        sparkPositions[i * 3 + 1] = Math.random() * 2.0;
        sparkPositions[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
        sparkRandoms[i] = Math.random(); 
    }

    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    sparkGeo.setAttribute('aRandom', new THREE.BufferAttribute(sparkRandoms, 1));

    sparkMaterial = new THREE.ShaderMaterial({
        uniforms: { 
            uTime: { value: 0.0 },
            uIntensity: { value: 0.5 } // New Uniform!
        },
        vertexShader: `
            uniform float uTime;
            uniform float uIntensity;
            attribute float aRandom;
            varying float vOpacity;

            void main() {
                // If the particle's random ID is higher than our intensity, 
                // we "kill" it by scaling it to zero.
                if (aRandom > uIntensity) {
                    gl_PointSize = 0.0;
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // Throw it off-screen
                } else {
                    float time = uTime * (0.3 + aRandom * 0.5);
                    float life = mod(time + aRandom, 1.0);
                    vec3 pos = position;
                    pos.y = life * 3.0; 
                    pos.x += sin(life * 5.0 + aRandom * 10.0) * 0.2;
                    pos.z += cos(life * 4.0 + aRandom * 10.0) * 0.2;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = (10.0 * aRandom) * (1.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                    vOpacity = sin(life * 3.14159); 
                }
            }
        `,
        fragmentShader: `
            varying float vOpacity;
            void main() {
                float d = distance(gl_PointCoord, vec2(0.5));
                if (d > 0.5) discard;
                gl_FragColor = vec4(1.0, 0.5, 0.0, vOpacity);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const sparks = new THREE.Points(sparkGeo, sparkMaterial);
    campfireGroup.add(sparks);

    scene.add(campfireGroup);
}

function createForest(density = 2, areaSize = 100) {
    const spacing = 10 / density; // Higher density = lower spacing
    const safeZone = 10; // No trees within 10 units of the center

    // 1. Setup Geometries and Materials
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.2, 2, 8);
    const leavesGeo = new THREE.ConeGeometry(1.5, 4, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f });
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x0a290a });

    // 2. Estimate count based on area and spacing
    const count = Math.pow((areaSize / spacing), 2);
    
    // 3. Create Instanced Meshes
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const leavesMesh = new THREE.InstancedMesh(leavesGeo, leavesMat, count);
    
    trunkMesh.castShadow = true;
    leavesMesh.castShadow = true;

    let i = 0;
    const dummy = new THREE.Object3D();

    for (let x = -areaSize / 2; x < areaSize / 2; x += spacing) {
        for (let z = -areaSize / 2; z < areaSize / 2; z += spacing) {
            
            // Calculate distance from center
            const dist = Math.sqrt(x * x + z * z);
            if (dist < safeZone) continue;

            // Add "Jitter" so it's not a perfect grid
            const posX = x + (Math.random() - 0.5) * spacing;
            const posZ = z + (Math.random() - 0.5) * spacing;

            // Set Trunk Transform
            dummy.position.set(posX, 1, posZ); 
            dummy.updateMatrix();
            trunkMesh.setMatrixAt(i, dummy.matrix);

            // Set Leaves Transform (relative to trunk)
            dummy.position.set(posX, 3.5, posZ);
            dummy.updateMatrix();
            leavesMesh.setMatrixAt(i, dummy.matrix);

            i++;
        }
    }

    trunkMesh.count = i;
    leavesMesh.count = i;

    scene.add(trunkMesh);
    scene.add(leavesMesh);
}

// Usage: Higher density = more trees closer together
createForest(4, 120);
createCampfire();



// --------------------------------------------------------
// 3. ASSET LOADING (Crucial for 3D Models)
// --------------------------------------------------------
const loader = new GLTFLoader();
// IMPORTANT: Update this path to your actual model
loader.load('src/assets/zombie1.gltf', (gltf) => {
    zombie1Template = gltf.scene;
    zombie1Template.rotation.x = -Math.PI / 2;
    zombie1Animations = gltf.animations;
    
    // Optional: scale down if your model is huge
    zombie1Template.scale.set(1, 1, 1); 
    
    zombie1Template.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
    
    console.log("Zombie1 template loaded successfully!");
});
loader.load('src/assets/zombie2.gltf', (gltf) => {
    zombie2Template = gltf.scene;
    zombie2Animations = gltf.animations;
    
    // Optional: scale down if your model is huge
    zombie2Template.scale.set(2, 2, 2); 
    
    zombie2Template.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
    
    console.log("Zombie2 template loaded successfully!");
});
loader.load('src/assets/woodenbat.gltf', (gltf) => {
    woodenbatTemplate = gltf.scene;
    woodenbatAnimations = gltf.animations;
    
    woodenbatTemplate.scale.set(1.5, 1.5, 1.5); 
    woodenbatTemplate.position.copy(batBasePos);
    woodenbatTemplate.rotation.set(10.8, -31.0, -5);
    
    camera.add(woodenbatTemplate);

    woodenbatTemplate.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
    
    console.log("woodenbat template loaded successfully!");
});


// --------------------------------------------------------
// 4. INPUT & CONTROLS
// --------------------------------------------------------
const keys = { w: false, a: false, s: false, d: false };
const speed = 5.0;

// Pointer Lock for FPS view
document.addEventListener('click', () => {
    if (!isPlaying && health > 0 && zombie1Template) {
        document.body.requestPointerLock();
    }
});

document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === document.body) {
        isPlaying = true;
        menus.style.display = 'none';
    } else {
        isPlaying = false;
        if (health > 0) menus.style.display = 'flex';
    }
});

document.addEventListener('mousemove', (event) => {
    if (isPlaying) {
        camera.rotation.y -= event.movementX * 0.002;
        camera.rotation.x -= event.movementY * 0.002;
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
    }
});

document.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;

    // Check if the player is dead and presses Space
    if (e.code === 'Space' && health <= 0) {
        window.location.reload();
    }
});

document.addEventListener('keydown', (e) => keys[e.key.toLowerCase()] = true);
document.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

// --------------------------------------------------------
// 5. Bashing MECHANICS
// --------------------------------------------------------
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0); // Center of screen

const muzzleFlash = new THREE.PointLight(0xFFFFAA, 0, 10)
scene.add(muzzleFlash)

document.addEventListener('mousedown', (e) => {
    if (isPlaying && e.button === 0 && !isSwinging) {
        // 1. Trigger Animation State
        isSwinging = true;
        swingTimer = 0;

        // 2. Setup Raycaster for Melee Range
        raycaster.setFromCamera(center, camera);
        raycaster.far = 3.5; // Only hits things within 3.5 units (Melee Range)

        const intersects = raycaster.intersectObjects(targetHitboxes, true);
        if (intersects.length > 0) {
            const hitBox = intersects[0].object;
            const zombieModel = hitBox.userData.parentZombie;
            
            setTimeout(() => {
                // Subtract health
                zombieModel.userData.health -= 1;

                if (zombieModel.userData.health <= 0) {
                    killZombie(zombieModel);
                } else {
                    // Optional: Visual feedback for a non-lethal hit
                    flashZombie(zombieModel);
                }
            }, 100);

            // Optional: Delay the kill slightly to match the "impact" of the swing
            //setTimeout(() => killZombie(zombieModel), 100);
        }
    }
});

// --------------------------------------------------------
// 6. ENEMY MANAGER
// --------------------------------------------------------
let lastSpawnTime = 0;
let spawnInterval = 2;
let zombiesSpawnedCount = 0; // Tracks total spawns to determine when zombie2 appears

function spawnZombie() {
    if (!zombie1Template || !zombie2Template) return;

    zombiesSpawnedCount++;

    // Determine which zombie to use: zombie2 every 10th spawn
    const isSpecialSpawn = zombiesSpawnedCount % 10 === 0;
    const template = (isSpecialSpawn && zombie2Template) ? zombie2Template : zombie1Template;
    const animations = (isSpecialSpawn && zombie2Template) ? zombie2Animations : zombie1Animations;

    // Use SkeletonUtils to clone the skinned mesh properly
    const clone = SkeletonUtils.clone(template);
    clone.userData.isZombie = true;

    clone.userData.health = isSpecialSpawn ? 5 : 1;

    // Add an invisible Hitbox
    let hitboxGeo;
    if (isSpecialSpawn) {
        // ZOMBIE 2: Standing upright, so use a tall cylinder
        hitboxGeo = new THREE.CylinderGeometry(0.6, 0.6, 2.5, 8); 
    } else {
        // ZOMBIE 1: Crawling, so use a flat, low box
        hitboxGeo = new THREE.BoxGeometry(1.5, 0.8, 2.5);
    }
    const hitboxMat = new THREE.MeshBasicMaterial({ 
        transparent: true, 
        opacity: 0.0,
        depthWrite: false
    }); 
    const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    if (isSpecialSpawn) {
        hitbox.position.y = 1.25; // Shift cylinder up to cover the torso
    } else {
        hitbox.position.y = 0.4;  // Keep the crawler box low
        hitbox.position.z = 1.0;  // Shift it forward
    }
    hitbox.userData.parentZombie = clone;
    clone.add(hitbox);
    targetHitboxes.push(hitbox);

    // Spawn in a circle outside the light radius
    const angle = Math.random() * Math.PI * 2;
    const radius = 25 + Math.random() * 10;
    clone.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    
    // Setup animation mixer for this specific clone
    if (animations.length > 0) {
        const mixer = new THREE.AnimationMixer(clone);
        
        let action;
        if (isSpecialSpawn) {
            // ZOMBIE 2: Play the running animation (Index 11)
            action = mixer.clipAction(animations[13]);
        } else {
            // ZOMBIE 1: Play the crawling animation (Index 0)
            action = mixer.clipAction(animations[13]);
        }
        
        action.play();
        mixers.push({ mixer: mixer, model: clone });
    }

    scene.add(clone);
    activeZombies.push(clone);
}

function killZombie(zombie) {
    //scene.remove(zombie);
    const index = activeZombies.indexOf(zombie);
    if (index > -1) {
        activeZombies.splice(index, 1);
        dyingZombies.push(zombie); // Move to list of dying zombies
    }
    
    const hbIndex = targetHitboxes.findIndex(hb => hb.userData.parentZombie === zombie);
    if (hbIndex > -1) targetHitboxes.splice(hbIndex, 1);

    // Clean up mixer
    const mixerIndex = mixers.findIndex(m => m.model === zombie);
    if (mixerIndex > -1) mixers.splice(mixerIndex, 1);

    score++;
    scoreDisplay.innerText = `Zombies Defeated: ${score}`;

    spawnInterval = Math.max(0.5, spawnInterval * 0.95); 
}

function updateZombies(deltaTime) {
    const zombieSpeed = 1.5 * deltaTime;
    const playerPos = new THREE.Vector3(camera.position.x, 0, camera.position.z);
    const attackInterval = 1.5; // Seconds between attacks

    for (let i = 0; i < activeZombies.length; i++) {
        const zombie = activeZombies[i];
        
        // Face player
        zombie.lookAt(playerPos);
        
        // Move towards player
        const distance = zombie.position.distanceTo(playerPos);
        
        if (distance > 1.8) {
            // Only move if not in attack range
            const direction = new THREE.Vector3().subVectors(playerPos, zombie.position).normalize();
            zombie.position.addScaledVector(direction, zombieSpeed);
        } else {
            // Collision/Attack logic
            const currentTime = clock.getElapsedTime();
            
            // Initialize attack timer if it doesn't exist
            if (zombie.userData.lastAttackTime === undefined) {
                zombie.userData.lastAttackTime = 0;
            }

            // Deal damage only if interval has passed
            if (currentTime - zombie.userData.lastAttackTime > attackInterval) {
                takeDamage();
                zombie.userData.lastAttackTime = currentTime;
                console.log("Zombie attacking!");
            }
        }
    }
}

function takeDamage() {
    health -= 10;
    healthDisplay.innerText = `Health: ${health}`;
    
    // Flash both the background AND the fog red
    scene.background.setHex(0x660000); // Used a slightly brighter red (0x660000)
    scene.fog.color.setHex(0x660000);  

    setTimeout(() => { 
        // Revert back to pitch black
        scene.background.setHex(0x020202); 
        scene.fog.color.setHex(0x020202); 
    }, 100);

    if (health <= 0) {
        die();
    }
}

function die() {
    isPlaying = false;
    document.exitPointerLock();
    menus.style.display = 'flex';
    instructions.style.display = 'none';
    gameOverScreen.style.display = 'block';
    finalScoreDisplay.innerText = `Zombies Defeated: ${score}`;
}

scene.add(camera);
// Add a dedicated light for the weapon so it's not pitch black
const weaponLight = new THREE.PointLight(0xffffff, 1, 5);
weaponLight.position.set(0, 0, 0); // At the camera's center
camera.add(weaponLight);

// --------------------------------------------------------
// 7. MAIN GAME LOOP
// --------------------------------------------------------
function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    // Update the fire shader time
    if (fireShaderMaterial) {
        fireShaderMaterial.uniforms.uTime.value = elapsedTime;
    }

    if (sparkMaterial) {
        sparkMaterial.uniforms.uTime.value = elapsedTime;
        
    }

    // Update star rotation
    stars.rotation.y = elapsedTime * 0.02;
    stars.rotation.x = elapsedTime * 0.01;

    if (isPlaying) {
        // Player Movement (Now frame-rate independent)
        const moveDistance = speed * deltaTime;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        forward.y = 0; forward.normalize();
        const right = new THREE.Vector3().crossVectors(camera.up, forward).normalize();

        if (keys.w) camera.position.addScaledVector(forward, moveDistance);
        if (keys.s) camera.position.addScaledVector(forward, -moveDistance);
        if (keys.a) camera.position.addScaledVector(right, moveDistance);
        if (keys.d) camera.position.addScaledVector(right, -moveDistance);

        let isMoving = keys.w || keys.s || keys.a || keys.d;
        if (isMoving) {
            walkTime += deltaTime * 12; // Controls speed of footsteps
            camera.position.y = 1.8 + Math.sin(walkTime) * 0.08; // Vertical Bobbing motion
            camera.rotation.z = Math.cos(walkTime * 0.5) * 0.015; // Side-to-side head tilt for weight shifting effect
        } else {
            // Return to standing position smoothly
            camera.position.y = THREE.MathUtils.lerp(camera.position.y, 1.8, 0.1);
            camera.rotation.z = THREE.MathUtils.lerp(camera.rotation.z, 0, 0.1);
        }


        if (elapsedTime - lastSpawnTime > spawnInterval) {
            spawnZombie();
            lastSpawnTime = elapsedTime;
        }

        updateZombies(deltaTime);

        // dying/melting animation
        for (let i = dyingZombies.length - 1; i >= 0; i--) {
            const z = dyingZombies[i];
            
            // 1. Squash flat to the ground quickly
            z.scale.y = THREE.MathUtils.lerp(z.scale.y, 0, deltaTime * 8);
            
            // 2. Shrink overall
            z.scale.x = THREE.MathUtils.lerp(z.scale.x, 0, deltaTime * 3);
            z.scale.z = THREE.MathUtils.lerp(z.scale.z, 0, deltaTime * 3);
            
            // 3. Slowly sink
            z.position.y -= deltaTime * 0.5;
            
            // 4. Clean up
            if (z.scale.x < 0.05) {
                scene.remove(z);
                dyingZombies.splice(i, 1);
            }
        }
    }

    // Update animations
    mixers.forEach(m => m.mixer.update(deltaTime));
    
    // Flicker firelight
    fireLight.intensity = 50.0 + Math.random() * 5.0;

    if (woodenbatTemplate) {
        if (isSwinging) {
            swingTimer += deltaTime * 12; 
            const swingProgress = Math.min(swingTimer, Math.PI);
            // Replace the arc variables with this for a sharper start/finish
            const easedProgress = Math.sin(swingProgress);
            const arcX = Math.pow(easedProgress, 2) * 1.5; // Starts slower, snaps faster
        
            woodenbatTemplate.rotation.x = batBaseRot.x - arcX;
            
            // 2. Horizontal Sweep (Y-Axis): 
            // This is what makes it feel like it's coming "across" the body
            // We add to the base rotation to sweep from right to left
            const arcY = Math.sin(swingProgress) * 1.2; 
            woodenbatTemplate.rotation.y = batBaseRot.y - arcY;

            if (swingTimer >= Math.PI) {
                isSwinging = false;
                // Reset to resting orientation
                woodenbatTemplate.rotation.set(batBaseRot.x, batBaseRot.y, batBaseRot.z);
                woodenbatTemplate.position.copy(batBasePos);
            }
        } else {
            // Idle sway
            const idleSway = Math.sin(elapsedTime * 2) * 0.02;
            woodenbatTemplate.position.y = batBasePos.y + idleSway;
        }
    }

    renderer.render(scene, camera);
}

// Start the loop
animate();

// Handle Window Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
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
camera.position.set(0, 1.8, 8); // Start at center (campfire)
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
let zombieTemplate = null; // Holds the loaded model
let zombieAnimations = [];
const activeZombies = [];
const mixers = [];
const fireFlames = []; // Array to hold our animated fire particles

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
    return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.7, transparent: true, opacity: 0.8, sizeAttenuation: true }));
}

const stars = createStarfield(2000);
scene.add(stars);

// --- FIRE SHADERS ---
const firePositions = new Float32Array(600);
const fireRandoms = new Float32Array(200);
for (let i = 0; i < 200; i++) {
    firePositions.set([(Math.random() - 0.5) * 0.5, Math.random() * 1.5, (Math.random() - 0.5) * 0.5], i * 3);
    fireRandoms[i] = Math.random();
}
const fireGeometry = new THREE.BufferGeometry();
fireGeometry.setAttribute('position', new THREE.BufferAttribute(firePositions, 3));
fireGeometry.setAttribute('aRandom', new THREE.BufferAttribute(fireRandoms, 1));

const fireMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0.0 } },
    vertexShader: `varying float vOpacity; attribute float aRandom; uniform float uTime; void main() { vec3 pos = position; float progress = mod(pos.y + uTime * (0.4 + aRandom * 0.2), 1.0); pos.y = progress; float taper = 1.0 - progress; pos.x *= taper; pos.z *= taper; vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0); gl_PointSize = (25.0 + aRandom * 15.0) * (1.0 / -mvPosition.z); gl_Position = projectionMatrix * mvPosition; vOpacity = taper; }`,
    fragmentShader: `varying float vOpacity; void main() { float d = distance(gl_PointCoord, vec2(0.5)); if (d > 0.5) discard; vec3 color = mix(vec3(1.0, 0.1, 0.0), vec3(1.0, 0.8, 0.3), vOpacity); gl_FragColor = vec4(color, vOpacity * 0.9); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
});
const fire = new THREE.Points(fireGeometry, fireMaterial);
fire.position.y = 0.1;
scene.add(fire);

/*function createCampfire() {
    const campfireGroup = new THREE.Group();

    // 1. Logs (More logs, slightly thicker for a bigger base)
    const logMaterial = new THREE.MeshStandardMaterial({ color: 0x3d1c04, roughness: 1.0 });
    const logGeometry = new THREE.CylinderGeometry(0.15, 0.15, 1.5, 8);
    
    for (let i = 0; i < 6; i++) {
        const log = new THREE.Mesh(logGeometry, logMaterial);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = (Math.PI / 3) * i;
        log.position.y = 0.1;
        log.castShadow = true;
        log.receiveShadow = true;
        campfireGroup.add(log);
    }

    // 2. Glowing Embers Base
    const emberGeo = new THREE.SphereGeometry(0.6, 8, 8);
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xff3300, fog: false });
    const embers = new THREE.Mesh(emberGeo, emberMat);
    embers.position.y = 0.1;
    embers.scale.y = 0.3; // Flatten it into a bed of coals
    campfireGroup.add(embers);

    // 3. Dynamic Flames using Additive Blending
    const flameGeo = new THREE.ConeGeometry(0.4, 1.5, 5); // Taller cones
    
    for (let i = 0; i < 15; i++) {
        const flameMat = new THREE.MeshBasicMaterial({ 
            color: Math.random() > 0.5 ? 0xffaa00 : 0xff4400, // Mix of yellow and orange
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending, // The magic ingredient for glowing fire
            depthWrite: false, // Prevents weird overlapping visual glitches
            fog: false // Cuts through the darkness
        });

        const flame = new THREE.Mesh(flameGeo, flameMat);
        
        // Randomize starting positions and sizes
        flame.position.set(
            (Math.random() - 0.5) * 0.8,
            0.2 + Math.random(),
            (Math.random() - 0.5) * 0.8
        );
        flame.rotation.set(
            (Math.random() - 0.5) * 0.3,
            Math.random() * Math.PI,
            (Math.random() - 0.5) * 0.3
        );
        flame.scale.setScalar(0.5 + Math.random() * 0.8);

        // Store custom data on the mesh so we can animate it easily
        flame.userData = {
            speed: 1.5 + Math.random() * 2,
            baseScale: flame.scale.x,
            offset: Math.random() * 100 // For randomized flickering
        };

        fireFlames.push(flame);
        campfireGroup.add(flame);
    }

    scene.add(campfireGroup);
}*/

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

    scene.add(trunkMesh);
    scene.add(leavesMesh);
}

// Usage: Higher density = more trees closer together
createForest(4, 120);
//createCampfire();


// --------------------------------------------------------
// 3. ASSET LOADING (Crucial for 3D Models)
// --------------------------------------------------------
const loader = new GLTFLoader();
// IMPORTANT: Update this path to your actual model
loader.load('src/assets/zombie.gltf', (gltf) => {
    zombieTemplate = gltf.scene;
    zombieAnimations = gltf.animations;
    
    // Optional: scale down if your model is huge
    zombieTemplate.scale.set(1, 1, 1); 
    
    zombieTemplate.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
    
    console.log("Zombie template loaded successfully!");
}, undefined, (error) => {
    console.error("Error loading model:", error);
});

// --------------------------------------------------------
// 4. INPUT & CONTROLS
// --------------------------------------------------------
const keys = { w: false, a: false, s: false, d: false };
const speed = 0.1;

// Pointer Lock for FPS view
document.addEventListener('click', () => {
    if (!isPlaying && health > 0 && zombieTemplate) {
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

document.addEventListener('keydown', (e) => keys[e.key.toLowerCase()] = true);
document.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

// --------------------------------------------------------
// 5. SHOOTING MECHANICS (Raycaster)
// --------------------------------------------------------
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0); // Center of screen

document.addEventListener('mousedown', (e) => {
    if (isPlaying && e.button === 0) {
        raycaster.setFromCamera(center, camera);
        
        // Check intersections with zombies
        const intersects = raycaster.intersectObjects(activeZombies, true);
        
        if (intersects.length > 0) {
            // Find the root object of the hit zombie
            let hitObject = intersects[0].object;
            while (hitObject.parent && !hitObject.userData.isZombie) {
                hitObject = hitObject.parent;
            }
            
            if (hitObject.userData.isZombie) {
                killZombie(hitObject);
            }
        }
    }
});

// --------------------------------------------------------
// 6. ENEMY MANAGER
// --------------------------------------------------------
let lastSpawnTime = 0;
const spawnInterval = 3; // Spawn a zombie every 3 seconds

function spawnZombie() {
    if (!zombieTemplate) return;

    // Use SkeletonUtils to clone the skinned mesh properly
    const clone = SkeletonUtils.clone(zombieTemplate);
    clone.userData.isZombie = true;

    // Spawn in a circle outside the light radius
    const angle = Math.random() * Math.PI * 2;
    const radius = 25 + Math.random() * 10;
    clone.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    
    // Setup animation mixer for this specific clone
    if (zombieAnimations.length > 0) {
        const mixer = new THREE.AnimationMixer(clone);
        const action = mixer.clipAction(zombieAnimations[0]); // Assuming 0 is walk cycle
        action.play();
        mixers.push({ mixer: mixer, model: clone });
    }

    scene.add(clone);
    activeZombies.push(clone);
}

function killZombie(zombie) {
    scene.remove(zombie);
    const index = activeZombies.indexOf(zombie);
    if (index > -1) activeZombies.splice(index, 1);
    
    // Clean up mixer
    const mixerIndex = mixers.findIndex(m => m.model === zombie);
    if (mixerIndex > -1) mixers.splice(mixerIndex, 1);

    score++;
    scoreDisplay.innerText = `Zombies Defeated: ${score}`;
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
    
    // Flash screen red
    scene.background = new THREE.Color(0x330000);
    setTimeout(() => { scene.background = new THREE.Color(0x020202); }, 100);

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

// --------------------------------------------------------
// 7. MAIN GAME LOOP
// --------------------------------------------------------
function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    // Update shader times
    fireMaterial.uniforms.uTime.value = elapsedTime;

    // Update star rotation
    stars.rotation.y = elapsedTime * 0.02;
    stars.rotation.x = elapsedTime * 0.01;

    if (isPlaying) {
        // Player Movement
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        forward.y = 0; forward.normalize();
        const right = new THREE.Vector3().crossVectors(camera.up, forward).normalize();

        if (keys.w) camera.position.addScaledVector(forward, speed);
        if (keys.s) camera.position.addScaledVector(forward, -speed);
        if (keys.a) camera.position.addScaledVector(right, speed);
        if (keys.d) camera.position.addScaledVector(right, -speed);

        camera.position.y = 1.8;

        if (elapsedTime - lastSpawnTime > spawnInterval) {
            spawnZombie();
            lastSpawnTime = elapsedTime;
        }

        updateZombies(deltaTime);
    }

    mixers.forEach(m => m.mixer.update(deltaTime));
    
    // Flicker firelight (Keep this)
    fireLight.intensity = 10.0 + Math.random() * 5.0;

    renderer.render(scene, camera);
}

animate();

// Handle Window Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
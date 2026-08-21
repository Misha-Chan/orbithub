/* ===== Three.js 403 Forbidden Scene ===== */
(function() {
    'use strict';

    // ===== Scene Setup =====
    const canvas = document.getElementById('three-canvas');
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a0a, 0.035);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 6);

    const renderer = new THREE.WebGLRenderer({ 
        canvas: canvas, 
        antialias: true, 
        alpha: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a0a, 1);

    // ===== Lighting =====
    const ambientLight = new THREE.AmbientLight(0x3e2723, 0.6);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xc9a96e, 1.2);
    mainLight.position.set(5, 5, 5);
    scene.add(mainLight);

    const rimLight = new THREE.PointLight(0x8d6e63, 0.8, 20);
    rimLight.position.set(-5, 3, -5);
    scene.add(rimLight);

    const bottomLight = new THREE.PointLight(0x5d4037, 0.5, 15);
    bottomLight.position.set(0, -4, 2);
    scene.add(bottomLight);

    // ===== Central Forbidden Shield / Barrier =====
    const shieldGroup = new THREE.Group();
    scene.add(shieldGroup);

    // Main shield - Icosahedron
    const shieldGeo = new THREE.IcosahedronGeometry(1.4, 1);
    const shieldMat = new THREE.MeshPhysicalMaterial({
        color: 0x5d4037,
        metalness: 0.7,
        roughness: 0.3,
        emissive: 0x3e2723,
        emissiveIntensity: 0.2,
        clearcoat: 0.5,
        clearcoatRoughness: 0.2,
        transparent: true,
        opacity: 0.9
    });
    const shield = new THREE.Mesh(shieldGeo, shieldMat);
    shieldGroup.add(shield);

    // Inner wireframe
    const wireGeo = new THREE.IcosahedronGeometry(1.35, 1);
    const wireMat = new THREE.MeshBasicMaterial({
        color: 0xc9a96e,
        wireframe: true,
        transparent: true,
        opacity: 0.15
    });
    const wireframe = new THREE.Mesh(wireGeo, wireMat);
    shieldGroup.add(wireframe);

    // Outer glow ring
    const ringGeo = new THREE.TorusGeometry(2.2, 0.02, 16, 100);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xc9a96e,
        transparent: true,
        opacity: 0.3
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    shieldGroup.add(ring);

    // Second ring tilted
    const ring2 = ring.clone();
    ring2.rotation.x = Math.PI / 3;
    ring2.scale.set(1.3, 1.3, 1.3);
    ring2.material = ringMat.clone();
    ring2.material.opacity = 0.15;
    shieldGroup.add(ring2);

    // ===== Floating Particles =====
    const particlesCount = 120;
    const positions = new Float32Array(particlesCount * 3);
    const colors = new Float32Array(particlesCount * 3);
    const sizes = new Float32Array(particlesCount);

    const colorPalette = [
        new THREE.Color(0xc9a96e),
        new THREE.Color(0x8d6e63),
        new THREE.Color(0xbcaaa4),
        new THREE.Color(0x5d4037)
    ];

    for (let i = 0; i < particlesCount; i++) {
        const i3 = i * 3;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const radius = 3 + Math.random() * 5;

        positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i3 + 2] = radius * Math.cos(phi);

        const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
        colors[i3] = color.r;
        colors[i3 + 1] = color.g;
        colors[i3 + 2] = color.b;

        sizes[i] = Math.random() * 3 + 1;
    }

    const particlesGeo = new THREE.BufferGeometry();
    particlesGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particlesGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    particlesGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const particlesMat = new THREE.PointsMaterial({
        size: 0.05,
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
    });

    const particles = new THREE.Points(particlesGeo, particlesMat);
    scene.add(particles);

    // ===== Floating Cubes (Debris) =====
    const debrisGroup = new THREE.Group();
    scene.add(debrisGroup);

    const debrisGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const debrisMat = new THREE.MeshPhysicalMaterial({
        color: 0x8d6e63,
        metalness: 0.8,
        roughness: 0.4,
        transparent: true,
        opacity: 0.6
    });

    const debrisCount = 30;
    const debrisMeshes = [];

    for (let i = 0; i < debrisCount; i++) {
        const mesh = new THREE.Mesh(debrisGeo, debrisMat.clone());
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        const r = 2.5 + Math.random() * 3;

        mesh.position.set(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi)
        );

        mesh.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
        );

        mesh.userData = {
            rotSpeed: {
                x: (Math.random() - 0.5) * 0.02,
                y: (Math.random() - 0.5) * 0.02,
                z: (Math.random() - 0.5) * 0.02
            },
            orbitSpeed: (Math.random() - 0.5) * 0.003,
            orbitRadius: r,
            orbitAngle: theta,
            orbitAxis: new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize()
        };

        debrisMeshes.push(mesh);
        debrisGroup.add(mesh);
    }

    // ===== Background Stars =====
    const starsGeo = new THREE.BufferGeometry();
    const starsCount = 300;
    const starsPos = new Float32Array(starsCount * 3);

    for (let i = 0; i < starsCount * 3; i++) {
        starsPos[i] = (Math.random() - 0.5) * 40;
    }

    starsGeo.setAttribute('position', new THREE.BufferAttribute(starsPos, 3));

    const starsMat = new THREE.PointsMaterial({
        color: 0xbcaaa4,
        size: 0.03,
        transparent: true,
        opacity: 0.4,
        sizeAttenuation: true
    });

    const stars = new THREE.Points(starsGeo, starsMat);
    scene.add(stars);

    // ===== Mouse Interaction =====
    let mouseX = 0, mouseY = 0;
    let targetX = 0, targetY = 0;

    document.addEventListener('mousemove', (e) => {
        mouseX = (e.clientX / window.innerWidth) * 2 - 1;
        mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    // ===== Cursor Glow Effect =====
    const glow = document.createElement('div');
    glow.className = 'cursor-glow';
    document.body.appendChild(glow);

    document.addEventListener('mousemove', (e) => {
        glow.style.left = e.clientX + 'px';
        glow.style.top = e.clientY + 'px';
    });

    // ===== Animation Loop =====
    const clock = new THREE.Clock();

    function animate() {
        requestAnimationFrame(animate);
        const elapsed = clock.getElapsedTime();
        const delta = clock.getDelta();

        // Smooth mouse follow
        targetX += (mouseX - targetX) * 0.05;
        targetY += (mouseY - targetY) * 0.05;

        // Shield animation
        shield.rotation.y = elapsed * 0.3;
        shield.rotation.x = Math.sin(elapsed * 0.2) * 0.1;
        shield.position.y = Math.sin(elapsed * 0.5) * 0.15;

        // Wireframe counter-rotation
        wireframe.rotation.y = -elapsed * 0.2;
        wireframe.rotation.z = elapsed * 0.1;
        wireframe.position.y = shield.position.y;

        // Rings animation
        ring.rotation.z = elapsed * 0.15;
        ring2.rotation.z = -elapsed * 0.1;
        ring2.rotation.x = Math.PI / 3 + Math.sin(elapsed * 0.3) * 0.1;

        // Particles slow rotation
        particles.rotation.y = elapsed * 0.02;
        particles.rotation.x = Math.sin(elapsed * 0.1) * 0.05;

        // Debris orbit
        debrisMeshes.forEach(mesh => {
            const ud = mesh.userData;
            mesh.rotation.x += ud.rotSpeed.x;
            mesh.rotation.y += ud.rotSpeed.y;
            mesh.rotation.z += ud.rotSpeed.z;

            // Orbit around center
            const axis = ud.orbitAxis;
            mesh.position.applyAxisAngle(axis, ud.orbitSpeed);
        });

        // Camera parallax
        camera.position.x += (targetX * 0.8 - camera.position.x) * 0.03;
        camera.position.y += (targetY * 0.5 - camera.position.y) * 0.03;
        camera.lookAt(0, 0, 0);

        // Pulse shield emissive
        shieldMat.emissiveIntensity = 0.15 + Math.sin(elapsed * 2) * 0.08;

        // Stars twinkle
        starsMat.opacity = 0.3 + Math.sin(elapsed * 0.5) * 0.1;

        renderer.render(scene, camera);
    }

    animate();

    // ===== Resize Handler =====
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ===== Digit Stagger Animation =====
    document.querySelectorAll('.digit').forEach(digit => {
        const delay = parseInt(digit.dataset.delay);
        setTimeout(() => {
            digit.style.animationDelay = '0s';
            digit.style.animationPlayState = 'running';
        }, delay);
    });

})();

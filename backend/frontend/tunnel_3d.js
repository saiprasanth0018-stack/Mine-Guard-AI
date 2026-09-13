/* ═══════════════════════════════════════════════════════════════════
   MINEGUARD AI — tunnel_3d.js
   3D mine map · Three.js r128 · SIH26039 · Team LABELX
   Part 1/4 · Setup, orbit controls, lighting, grid, raycaster
═══════════════════════════════════════════════════════════════════ */

'use strict';

const T3D = {
  dashScene: null, dashCam: null, dashRenderer: null,
  fullScene: null, fullCam: null, fullRenderer: null,
  dashCanvas: null, fullCanvas: null,
  clock: null, raycaster: null, mouse: null,
  clickables: [], fullClickables: [],
  hoverTooltip: null,
  controlsDash: null, controlsFull: null,
  events: { grid: false, ch4: false, lhd: false, roof: false, p2v: false, mesh: false, buzzer: false, rover: false }
};

const COLORS = {
  bg: 0x050b12, tunnel: 0x1a3a55, tunnelWall: 0x0e2233,
  tunnelA: 0x38bdf8, tunnelB: 0x22c55e, tunnelC: 0xf59e0b, tunnelD: 0xef4444,
  shaftA: 0x38bdf8, shaftB: 0xf59e0b,
  gold: 0xfbbf24,
  workerSafe: 0x22c55e, workerWarn: 0xf59e0b, workerCrit: 0xef4444,
  rover: 0x22d3ee, lhd: 0xfbbf24,
  hazard: 0xef4444, water: 0x22d3ee, junction: 0x4b7a9c, fault: 0xeab308
};

function webglSupported() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) { return false; }
}

function createOrbitControls(camera, domElement, target) {
  const state = {
    target: target || new THREE.Vector3(0, 0, 0),
    theta: Math.PI / 4, phi: Math.PI / 3, radius: 34,
    isDragging: false, lastX: 0, lastY: 0,
    minRadius: 10, maxRadius: 90, minPhi: 0.15, maxPhi: Math.PI / 2.1
  };

  function update() {
    const t = state.target;
    const x = t.x + state.radius * Math.sin(state.phi) * Math.cos(state.theta);
    const y = t.y + state.radius * Math.cos(state.phi);
    const z = t.z + state.radius * Math.sin(state.phi) * Math.sin(state.theta);
    camera.position.set(x, y, z);
    camera.lookAt(t);
  }

  domElement.addEventListener('mousedown', e => {
    state.isDragging = true; state.lastX = e.clientX; state.lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => { state.isDragging = false; });
  window.addEventListener('mousemove', e => {
    if (!state.isDragging) return;
    const dx = e.clientX - state.lastX;
    const dy = e.clientY - state.lastY;
    state.lastX = e.clientX; state.lastY = e.clientY;
    state.theta -= dx * 0.006;
    state.phi = Math.max(state.minPhi, Math.min(state.maxPhi, state.phi - dy * 0.006));
    update();
  });
  domElement.addEventListener('wheel', e => {
    e.preventDefault();
    state.radius = Math.max(state.minRadius, Math.min(state.maxRadius, state.radius + e.deltaY * 0.03));
    update();
  }, { passive: false });

  let touchDist = 0;
  domElement.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      state.isDragging = true;
      state.lastX = e.touches[0].clientX;
      state.lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchDist = Math.sqrt(dx * dx + dy * dy);
    }
  }, { passive: true });
  domElement.addEventListener('touchmove', e => {
    if (e.touches.length === 1 && state.isDragging) {
      const dx = e.touches[0].clientX - state.lastX;
      const dy = e.touches[0].clientY - state.lastY;
      state.lastX = e.touches[0].clientX;
      state.lastY = e.touches[0].clientY;
      state.theta -= dx * 0.008;
      state.phi = Math.max(state.minPhi, Math.min(state.maxPhi, state.phi - dy * 0.008));
      update();
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.sqrt(dx * dx + dy * dy);
      state.radius = Math.max(state.minRadius, Math.min(state.maxRadius, state.radius + (touchDist - d) * 0.05));
      touchDist = d;
      update();
    }
  }, { passive: true });
  domElement.addEventListener('touchend', () => { state.isDragging = false; }, { passive: true });

  update();

  return {
    update, state,
    reset() { state.theta = Math.PI / 4; state.phi = Math.PI / 3; state.radius = 34; state.target.set(0, 0, 0); update(); },
    focusOn(x, y, z, r) { state.target.set(x, y, z); state.radius = r || 24; update(); }
  };
}

function buildLighting(scene) {
  scene.add(new THREE.AmbientLight(0x6688aa, 0.55));
  scene.add(new THREE.HemisphereLight(0x88ccff, 0x0a1420, 0.45));
  const key = new THREE.DirectionalLight(0xaaddff, 0.85);
  key.position.set(20, 40, 20);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x38bdf8, 0.35);
  rim.position.set(-20, 15, -20);
  scene.add(rim);
  const under = new THREE.PointLight(0x0284c7, 0.4, 80);
  under.position.set(0, -8, 0);
  scene.add(under);
}

function buildGridFloor(scene) {
  const grid = new THREE.GridHelper(80, 40, 0x1e3a52, 0x0d2030);
  grid.position.y = -2.2;
  grid.material.opacity = 0.55;
  grid.material.transparent = true;
  scene.add(grid);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0x050b12, roughness: 0.95, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.3;
  scene.add(floor);
}

function buildRaycaster() {
  T3D.raycaster = new THREE.Raycaster();
  T3D.mouse = new THREE.Vector2();
  const tooltip = document.createElement('div');
  tooltip.className = 'map-tooltip';
  tooltip.style.cssText = 'position: fixed; pointer-events: none; z-index: 999; background: rgba(8,19,28,0.95); color: #e6f1f7; border: 1px solid #1e3a52; border-radius: 6px; padding: 6px 10px; font-size: 11px; font-family: monospace; display: none; box-shadow: 0 4px 14px rgba(0,0,0,0.5); letter-spacing: 0.3px;';
  document.body.appendChild(tooltip);
  T3D.hoverTooltip = tooltip;
}
/* ═══ Part 2/4 · Tunnels, junctions, shafts, fault, entities ═══ */

function buildTunnel(scene, from, to, colorHex, radius = 0.7, opacity = 0.6) {
  const start = new THREE.Vector3(from[0], from[1], from[2]);
  const end = new THREE.Vector3(to[0], to[1], to[2]);
  const len = start.distanceTo(end);

  const geo = new THREE.CylinderGeometry(radius, radius, len, 12, 1, true);
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex, emissive: colorHex, emissiveIntensity: 0.35,
    transparent: true, opacity: opacity,
    roughness: 0.7, metalness: 0.15, side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(start.clone().add(end).multiplyScalar(0.5));

  const dir = end.clone().sub(start).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  mesh.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(up, dir));

  scene.add(mesh);
  return mesh;
}

function buildJunction(scene, pos, colorHex = COLORS.junction, radius = 1.4) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 20, 16),
    new THREE.MeshStandardMaterial({
      color: colorHex, emissive: colorHex, emissiveIntensity: 0.45,
      transparent: true, opacity: 0.85, roughness: 0.5, metalness: 0.3
    })
  );
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.userData.clickable = true;
  mesh.userData.entityId = 'junction';
  mesh.userData.label = 'Junction';
  scene.add(mesh);
  return mesh;
}

function buildShaftA(scene, baseX = -18, baseZ = 8) {
  const group = new THREE.Group();
  group.position.set(baseX, 0, baseZ);
  group.userData.clickable = true;
  group.userData.entityId = 'shaftA';
  group.userData.label = 'SHAFT A · Main Intake';

  const conduit = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 18, 20, 1, true),
    new THREE.MeshStandardMaterial({
      color: COLORS.shaftA, emissive: COLORS.shaftA, emissiveIntensity: 0.4,
      transparent: true, opacity: 0.35, side: THREE.DoubleSide
    })
  );
  group.add(conduit);

  [0x38bdf8, 0x0ea5e9, 0x0284c7].forEach((c, i) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.4 - i * 0.5, 0.09, 10, 40),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.8, transparent: true, opacity: 0.9 - i * 0.15 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 9 - i * 0.5;
    group.add(ring);
  });

  for (let i = 0; i < 4; i++) {
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 0.9, 6),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 0.7 })
    );
    arrow.rotation.x = Math.PI;
    arrow.position.y = 5 - i * 3;
    group.add(arrow);
  }

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 0.9 })
  );
  cap.position.y = 9.6;
  group.add(cap);

  const light = new THREE.PointLight(0x38bdf8, 0.9, 20);
  light.position.y = 6;
  group.add(light);

  scene.add(group);
  return group;
}

function buildShaftB(scene, baseX = 18, baseZ = -12) {
  const group = new THREE.Group();
  group.position.set(baseX, 0, baseZ);
  group.userData.clickable = true;
  group.userData.entityId = 'shaftB';
  group.userData.label = 'SHAFT B · Upcast Ventilation';

  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.15, 16, 20, 1, true),
    new THREE.MeshStandardMaterial({
      color: COLORS.shaftB, emissive: COLORS.shaftB, emissiveIntensity: 0.4,
      transparent: true, opacity: 0.32, side: THREE.DoubleSide
    })
  );
  stack.position.y = -1;
  group.add(stack);

  const rotorGroup = new THREE.Group();
  rotorGroup.position.y = 7;
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.9, 3.2),
      new THREE.MeshStandardMaterial({ color: COLORS.shaftB, emissive: COLORS.shaftB, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.35 })
    );
    blade.rotation.y = (Math.PI / 2) * i;
    blade.position.set(Math.cos((Math.PI / 2) * i) * 1.6, 0, Math.sin((Math.PI / 2) * i) * 1.6);
    rotorGroup.add(blade);
  }
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 0.4, 16),
    new THREE.MeshStandardMaterial({ color: 0x0d1f2c, emissive: COLORS.shaftB, emissiveIntensity: 0.3 })
  );
  rotorGroup.add(hub);
  group.add(rotorGroup);
  group.userData.rotor = rotorGroup;

  for (let i = 0; i < 3; i++) {
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.85, 6),
      new THREE.MeshStandardMaterial({ color: COLORS.shaftB, emissive: COLORS.shaftB, emissiveIntensity: 0.7 })
    );
    arrow.position.y = 10 + i * 1.6;
    group.add(arrow);
  }

  const light = new THREE.PointLight(COLORS.shaftB, 0.9, 20);
  light.position.y = 6;
  group.add(light);

  scene.add(group);
  return group;
}

function buildFaultLine(scene) {
  const points = [
    new THREE.Vector3(-2, 1.4, 24),
    new THREE.Vector3(2, 1.0, 12),
    new THREE.Vector3(-1, 0.8, 0),
    new THREE.Vector3(4, 1.0, -12),
    new THREE.Vector3(1, 1.4, -26)
  ];
  const curve = new THREE.CatmullRomCurve3(points);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 80, 0.12, 6, false),
    new THREE.MeshStandardMaterial({ color: COLORS.fault, emissive: COLORS.fault, emissiveIntensity: 0.7, transparent: true, opacity: 0.75 })
  );
  scene.add(tube);

  const pts = curve.getPoints(60);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineDashedMaterial({ color: COLORS.fault, dashSize: 0.6, gapSize: 0.5, transparent: true, opacity: 0.9 })
  );
  line.computeLineDistances();
  scene.add(line);
  return tube;
}

function buildMineLayout(scene) {
  buildTunnel(scene, [-16, 0, 8], [-6, 0.3, 4], COLORS.tunnelA, 0.85);
  buildTunnel(scene, [-6, 0.3, 4], [6, 0.3, 2], COLORS.tunnelA, 0.85);
  buildTunnel(scene, [6, 0.3, 2], [14, 0.6, -4], COLORS.tunnelB, 0.9);
  buildTunnel(scene, [14, 0.6, -4], [16, 0.8, -12], COLORS.tunnelB, 0.9);
  buildTunnel(scene, [6, 0.3, 2], [12, 0.4, 10], COLORS.tunnelC, 0.85);
  buildTunnel(scene, [12, 0.4, 10], [18, 0.3, 4], COLORS.tunnelC, 0.85);
  buildTunnel(scene, [16, 0.8, -12], [10, 1.2, -18], COLORS.tunnelD, 0.95, 0.8);
  buildTunnel(scene, [10, 1.2, -18], [4, 0.8, -20], COLORS.tunnelD, 0.95, 0.8);

  const j1 = buildJunction(scene, [-6, 0.3, 4]); j1.userData.label = 'Junction 1';
  const j2 = buildJunction(scene, [6, 0.3, 2]); j2.userData.label = 'Junction 2';
  const j3 = buildJunction(scene, [12, 0.4, 10]); j3.userData.label = 'Junction 3';

  scene.userData.shaftA = buildShaftA(scene, -20, 8);
  scene.userData.shaftB = buildShaftB(scene, 20, -12);

  buildFaultLine(scene);
}
/* ═══ Part 3/4 · Anchors, nodes, workers, LHD, rover, hazards, sump, entities ═══ */

function buildAnchor(scene, id, pos, label) {
  const group = new THREE.Group();
  group.position.set(pos[0], pos[1], pos[2]);
  group.userData.clickable = true;
  group.userData.entityId = id;
  group.userData.label = label;

  const diamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.45),
    new THREE.MeshStandardMaterial({ color: COLORS.gold, emissive: COLORS.gold, emissiveIntensity: 1.0, metalness: 0.7, roughness: 0.3 })
  );
  group.add(diamond);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.65, 0.05, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5, transparent: true, opacity: 0.7 })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  group.add(new THREE.PointLight(COLORS.gold, 0.4, 6));
  group.userData.baseY = pos[1];
  group.userData.bobPhase = Math.random() * Math.PI * 2;

  scene.add(group);
  return group;
}

function buildNode(scene, id, pos, colorHex, label) {
  const group = new THREE.Group();
  group.position.set(pos[0], pos[1], pos[2]);
  group.userData.clickable = true;
  group.userData.entityId = id;
  group.userData.label = label;

  group.add(new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 10),
    new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.9 })
  ));

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.38, 0.48, 24),
    new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.01;
  group.add(halo);
  group.userData.halo = halo;
  group.userData.haloScale = 0;

  scene.add(group);
  return group;
}

function buildWorker(scene, id, pos, status, label) {
  const color = status === 'safe' ? COLORS.workerSafe :
    status === 'trapped' || status === 'critical' ? COLORS.workerCrit :
      COLORS.workerWarn;

  const group = new THREE.Group();
  group.position.set(pos[0], pos[1], pos[2]);
  group.userData.clickable = true;
  group.userData.entityId = id;
  group.userData.label = label;
  group.userData.status = status;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: color, emissive: color, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.6
  });

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.94, 12),
    bodyMat
  );
  body.position.y = 0.5;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 12, 10),
    bodyMat
  );
  head.position.y = 1.05;
  group.add(head);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.65, 20),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);
  group.userData.ring = ring;

  if (status === 'trapped' || status === 'critical') {
    const badge = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.3),
      new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 1.0 })
    );
    badge.position.y = 1.6;
    group.add(badge);
    group.userData.badge = badge;
  }

  scene.add(group);
  return group;
}

function buildLHD(scene, pos) {
  const group = new THREE.Group();
  group.position.set(pos[0], pos[1], pos[2]);
  group.userData.clickable = true;
  group.userData.entityId = 'lhd01';
  group.userData.label = 'LHD-01 · Trackless Loader';

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.5, 1.8),
    new THREE.MeshStandardMaterial({ color: COLORS.lhd, emissive: COLORS.lhd, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.5 })
  );
  chassis.position.y = 0.45;
  group.add(chassis);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.6, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x1a1f24, metalness: 0.7, roughness: 0.4 })
  );
  cabin.position.set(-0.2, 1.0, 0);
  group.add(cabin);

  [-0.75, 0.75].forEach(x => {
    const track = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.35, 1.9),
      new THREE.MeshStandardMaterial({ color: 0x0d1f2c, metalness: 0.8, roughness: 0.6 })
    );
    track.position.set(x, 0.2, 0);
    group.add(track);
  });

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 1.0 })
  );
  beacon.position.set(-0.2, 1.4, 0);
  group.add(beacon);
  group.userData.beacon = beacon;

  const prox = new THREE.Mesh(
    new THREE.RingGeometry(1.9, 2.0, 32),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
  );
  prox.rotation.x = -Math.PI / 2;
  prox.position.y = 0.03;
  group.add(prox);
  group.userData.proxRing = prox;

  group.userData.patrol = [
    new THREE.Vector3(6, 0.3, 2),
    new THREE.Vector3(14, 0.6, -4),
    new THREE.Vector3(16, 0.8, -12)
  ];
  group.userData.patrolIdx = 0;
  group.userData.patrolProgress = 0;

  scene.add(group);
  return group;
}

function buildRover(scene, pos) {
  const group = new THREE.Group();
  group.position.set(pos[0], pos[1], pos[2]);
  group.userData.clickable = true;
  group.userData.entityId = 'roverR1';
  group.userData.label = 'ROV-01 · Rescue Rover';

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.35, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x0e7490, emissive: 0x22d3ee, emissiveIntensity: 0.5, metalness: 0.5, roughness: 0.5 })
  );
  chassis.position.y = 0.3;
  group.add(chassis);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 0.6 })
  );
  mast.position.set(0, 0.85, 0);
  group.add(mast);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 0.9 })
  );
  head.position.set(0, 1.2, 0);
  group.add(head);
  group.userData.head = head;

  [-0.42, 0.42].forEach(x => {
    const track = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.22, 1.15),
      new THREE.MeshStandardMaterial({ color: 0x0d1f2c, metalness: 0.8, roughness: 0.6 })
    );
    track.position.set(x, 0.15, 0);
    group.add(track);
  });

  const glow = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.0, 24),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.02;
  group.add(glow);
  group.userData.glow = glow;

  group.userData.home = new THREE.Vector3(20, 0.6, -18);
  group.userData.target = group.userData.home.clone();

  scene.add(group);
  return group;
}

function buildHazardZone(scene, pos, radius, colorHex = COLORS.hazard) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 20),
    new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.14, depthWrite: false })
  );
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.userData.isHazard = true;
  mesh.userData.baseOpacity = 0.14;
  scene.add(mesh);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.7, 20, 16),
    new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.24, depthWrite: false })
  );
  glow.position.copy(mesh.position);
  glow.userData.isHazardGlow = true;
  scene.add(glow);

  return mesh;
}

function buildSump(scene, pos) {
  const group = new THREE.Group();
  group.position.set(pos[0], pos[1], pos[2]);
  group.userData.clickable = true;
  group.userData.entityId = 'sump';
  group.userData.label = 'SUMP Basin · 22 % Fill';

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 32),
    new THREE.MeshStandardMaterial({ color: COLORS.water, emissive: COLORS.water, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.03;
  group.add(water);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.65, 0.07, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 0.8 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  group.add(ring);

  scene.add(group);
  return group;
}

function buildConstellation(scene, anchors) {
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]];
  const pts = [];
  pairs.forEach(([a, b]) => {
    pts.push(anchors[a].position.clone());
    pts.push(anchors[b].position.clone());
  });
  const line = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineDashedMaterial({ color: COLORS.gold, dashSize: 0.5, gapSize: 0.4, transparent: true, opacity: 0.55 })
  );
  line.computeLineDistances();
  scene.add(line);
  return line;
}

function buildEntities(scene) {
  const anchors = [
    buildAnchor(scene, 'anchorA1', [-14, 1.0, 8], 'UWB A1 · Zone 1'),
    buildAnchor(scene, 'anchorA2', [10, 1.0, -2], 'UWB A2 · Zone 2'),
    buildAnchor(scene, 'anchorA3', [16, 1.2, -12], 'UWB A3 · Zone 3'),
    buildAnchor(scene, 'anchorA4', [6, 0.8, 12], 'UWB A4 · Zone 4'),
    buildAnchor(scene, 'anchorA5', [18, 0.8, 4], 'UWB A5 · Zone 5')
  ];

  const nodes = [
    buildNode(scene, 'n1-1', [-13, 0.6, 7], 0x22c55e, 'Node N1-1 · Worker W1'),
    buildNode(scene, 'n1-2', [-11, 0.5, 5], 0x38bdf8, 'Node N1-2 · Airflow'),
    buildNode(scene, 'n1-3', [-9, 0.5, 4], 0x38bdf8, 'Node N1-3 · O₂'),
    buildNode(scene, 'n2-1', [8, 0.6, 0], 0xf59e0b, 'Node N2-1 · LHD-01'),
    buildNode(scene, 'n2-2', [12, 0.6, -6], 0xa855f7, 'Node N2-2 · Geophone #9'),
    buildNode(scene, 'n2-3', [14, 0.6, -10], 0x00e5ff, 'Node N2-3 · Sump'),
    buildNode(scene, 'n3-1', [15, 0.7, -13], 0xef4444, 'Node N3-1 · Worker W3 TRAPPED'),
    buildNode(scene, 'n3-2', [16, 0.8, -14], 0xef4444, 'Node N3-2 · CH₄'),
    buildNode(scene, 'n3-3', [17, 0.7, -15], 0xfb923c, 'Node N3-3 · Temp'),
    buildNode(scene, 'n4-1', [4, 0.5, 11], 0x38bdf8, 'Node N4-1 · Relay'),
    buildNode(scene, 'n4-2', [7, 0.5, 12], 0xa855f7, 'Node N4-2 · PIR'),
    buildNode(scene, 'n4-3', [9, 0.5, 12], 0x22c55e, 'Node N4-3 · CO'),
    buildNode(scene, 'n5-1', [16, 0.6, 4], 0x22c55e, 'Node N5-1 · Worker W2'),
    buildNode(scene, 'n5-2', [19, 0.6, 4], 0x22c55e, 'Node N5-2 · O₂ pressure')
  ];

  const workers = [
    buildWorker(scene, 'workerW1', [-13, 0.5, 7.2], 'safe', 'W1 · Manoj Mahato · SAFE'),
    buildWorker(scene, 'workerW2', [16, 0.6, 4.4], 'safe', 'W2 · Rajesh Kumar · SAFE'),
    buildWorker(scene, 'workerW3', [15, 0.6, -13.2], 'trapped', 'W3 · Sunil Tudu · TRAPPED')
  ];

  const lhd = buildLHD(scene, [8, 0.4, 0]);
  const rover = buildRover(scene, [20, 0.6, -18]);

  buildHazardZone(scene, [16, 1.0, -14], 4.0, 0xef4444);
  buildHazardZone(scene, [12, 0.8, -6], 2.6, 0xf59e0b);

  const sump = buildSump(scene, [14, 0.3, -10]);

  buildConstellation(scene, anchors);

  scene.userData.anchors = anchors;
  scene.userData.nodes = nodes;
  scene.userData.workers = workers;
  scene.userData.lhd = lhd;
  scene.userData.rover = rover;
  scene.userData.hazards = scene.userData.hazards || [];
  scene.userData.sump = sump;
}
/* ═══ Part 4/4 · Init, animation loop, raycast, events, exports ═══ */

function buildScene(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.bg);
  scene.fog = new THREE.Fog(COLORS.bg, 40, 95);

  const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 400);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  buildLighting(scene);
  buildGridFloor(scene);
  buildMineLayout(scene);
  buildEntities(scene);

  return { scene, camera, renderer };
}

function initMap3D() {
  if (!webglSupported()) { show2DFallback('mine3DCanvas'); return; }
  const canvas = document.getElementById('mine3DCanvas');
  if (!canvas) return;
  if (!window.THREE) { show2DFallback('mine3DCanvas'); return; }

  const built = buildScene(canvas);
  T3D.dashScene = built.scene;
  T3D.dashCam = built.camera;
  T3D.dashRenderer = built.renderer;
  T3D.dashCanvas = canvas;
  T3D.clock = new THREE.Clock();

  T3D.controlsDash = createOrbitControls(T3D.dashCam, canvas, new THREE.Vector3(0, 0, 0));
  T3D.controlsDash.state.radius = 40;
  T3D.controlsDash.update();

  if (!T3D.raycaster) buildRaycaster();
  T3D.clickables = [];
  collectClickables(T3D.dashScene, T3D.clickables);

  canvas.addEventListener('click', e => handleMapClick(e, T3D.dashCam, canvas, T3D.clickables));
  canvas.addEventListener('mousemove', e => handleMapHover(e, T3D.dashCam, canvas, T3D.clickables));
  window.addEventListener('resize', () => resizeRenderer(T3D.dashRenderer, T3D.dashCam, canvas));

  animateScene(T3D.dashScene, T3D.dashCam, T3D.dashRenderer, canvas);
  console.log('[3D] Dashboard map initialised');
}

function initFullMap3D() {
  if (T3D.fullScene) { resizeRenderer(T3D.fullRenderer, T3D.fullCam, T3D.fullCanvas); return; }
  if (!webglSupported()) { show2DFallback('mine3DFullCanvas'); return; }
  const canvas = document.getElementById('mine3DFullCanvas');
  if (!canvas) return;
  if (!window.THREE) { show2DFallback('mine3DFullCanvas'); return; }

  const built = buildScene(canvas);
  T3D.fullScene = built.scene;
  T3D.fullCam = built.camera;
  T3D.fullRenderer = built.renderer;
  T3D.fullCanvas = canvas;

  T3D.controlsFull = createOrbitControls(T3D.fullCam, canvas, new THREE.Vector3(0, 0, 0));
  T3D.controlsFull.state.radius = 46;
  T3D.controlsFull.update();

  if (!T3D.raycaster) buildRaycaster();
  T3D.fullClickables = [];
  collectClickables(T3D.fullScene, T3D.fullClickables);

  canvas.addEventListener('click', e => handleMapClick(e, T3D.fullCam, canvas, T3D.fullClickables));
  canvas.addEventListener('mousemove', e => handleMapHover(e, T3D.fullCam, canvas, T3D.fullClickables));
  window.addEventListener('resize', () => resizeRenderer(T3D.fullRenderer, T3D.fullCam, canvas));

  animateScene(T3D.fullScene, T3D.fullCam, T3D.fullRenderer, canvas);
  console.log('[3D] Full map initialised');
}

function resetFullMapCamera() { if (T3D.controlsFull) T3D.controlsFull.reset(); }

function collectClickables(scene, out) {
  scene.traverse(obj => { if (obj.userData && obj.userData.clickable) out.push(obj); });
}

function resizeRenderer(renderer, camera, canvas) {
  if (!canvas || !renderer) return;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function handleMapClick(event, camera, canvas, clickables) {
  const rect = canvas.getBoundingClientRect();
  T3D.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  T3D.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  T3D.raycaster.setFromCamera(T3D.mouse, camera);
  const hits = T3D.raycaster.intersectObjects(clickables, true);
  if (hits.length > 0) {
    let obj = hits[0].object;
    while (obj && !(obj.userData && obj.userData.clickable)) obj = obj.parent;
    if (obj && obj.userData && obj.userData.entityId && typeof window.focusEntity === 'function') {
      window.focusEntity(obj.userData.entityId);
    }
  }
}

function handleMapHover(event, camera, canvas, clickables) {
  const rect = canvas.getBoundingClientRect();
  T3D.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  T3D.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  T3D.raycaster.setFromCamera(T3D.mouse, camera);
  const hits = T3D.raycaster.intersectObjects(clickables, true);
  if (hits.length > 0) {
    let obj = hits[0].object;
    while (obj && !(obj.userData && obj.userData.clickable)) obj = obj.parent;
    if (obj && obj.userData && obj.userData.label) {
      T3D.hoverTooltip.textContent = obj.userData.label;
      T3D.hoverTooltip.style.display = 'block';
      T3D.hoverTooltip.style.left = (event.clientX + 14) + 'px';
      T3D.hoverTooltip.style.top = (event.clientY + 14) + 'px';
      canvas.style.cursor = 'pointer';
      return;
    }
  }
  T3D.hoverTooltip.style.display = 'none';
  canvas.style.cursor = 'grab';
}

function animateScene(scene, camera, renderer, canvas) {
  const clock = new THREE.Clock();

  function loop() {
    const dt = clock.getDelta();
    const t = clock.getElapsedTime();

    if (scene.userData.shaftB && scene.userData.shaftB.userData.rotor) {
      const speed = T3D.events.grid ? 1.0 : 3.2;
      scene.userData.shaftB.userData.rotor.rotation.y += dt * speed;
    }

    if (scene.userData.shaftA) {
      scene.userData.shaftA.children.forEach((c, i) => {
        if (c.geometry && c.geometry.type === 'TorusGeometry') c.rotation.z = t * 0.4 + i * 0.5;
      });
    }

    (scene.userData.anchors || []).forEach(a => {
      if (a.userData.baseY !== undefined) {
        a.position.y = a.userData.baseY + Math.sin(t * 1.4 + a.userData.bobPhase) * 0.12;
        a.rotation.y += dt * 0.6;
      }
    });

    (scene.userData.nodes || []).forEach(n => {
      if (n.userData.halo) {
        n.userData.haloScale += dt * 0.9;
        if (n.userData.haloScale > 1.6) n.userData.haloScale = 0;
        const s = 1 + n.userData.haloScale * 0.5;
        n.userData.halo.scale.set(s, s, s);
        n.userData.halo.material.opacity = Math.max(0, 0.6 - n.userData.haloScale * 0.35);
      }
    });

    (scene.userData.workers || []).forEach(w => {
      if (w.userData.badge) {
        w.userData.badge.rotation.y += dt * 2.2;
        w.userData.badge.rotation.x += dt * 1.1;
      }
      if (w.userData.ring) {
        const pulse = 1 + Math.sin(t * 2.2) * 0.12;
        w.userData.ring.scale.set(pulse, pulse, pulse);
      }
    });

    if (scene.userData.lhd) {
      const lhd = scene.userData.lhd;
      if (lhd.userData.beacon) lhd.userData.beacon.material.emissiveIntensity = 0.6 + Math.sin(t * 6) * 0.4;
      if (lhd.userData.proxRing) {
        const s = 1 + Math.sin(t * 2.6) * 0.08;
        lhd.userData.proxRing.scale.set(s, s, s);
        lhd.userData.proxRing.material.opacity = 0.3 + Math.sin(t * 2.6) * 0.15;
      }
      const path = lhd.userData.patrol;
      if (path && path.length >= 2) {
        const idx = lhd.userData.patrolIdx;
        const nextIdx = (idx + 1) % path.length;
        const from = path[idx], to = path[nextIdx];
        lhd.userData.patrolProgress += dt * 0.12;
        if (lhd.userData.patrolProgress >= 1) {
          lhd.userData.patrolProgress = 0;
          lhd.userData.patrolIdx = nextIdx;
        }
        const p = lhd.userData.patrolProgress;
        lhd.position.x = from.x + (to.x - from.x) * p;
        lhd.position.y = from.y + (to.y - from.y) * p;
        lhd.position.z = from.z + (to.z - from.z) * p;
        lhd.lookAt(to.x, lhd.position.y, to.z);
      }
    }

    if (scene.userData.rover) {
      const r = scene.userData.rover;
      if (r.userData.head) r.userData.head.rotation.y += dt * 1.8;
      if (r.userData.glow) r.userData.glow.material.opacity = 0.35 + Math.sin(t * 3) * 0.2;
      r.position.lerp(r.userData.target, Math.min(1, dt * 1.6));
    }

    (scene.userData.hazards || []).forEach(h => {
      if (h.material) h.material.opacity = h.userData.baseOpacity + Math.sin(t * 1.6) * 0.05;
    });
    scene.traverse(obj => {
      if (obj.userData && obj.userData.isHazardGlow) {
        obj.material.opacity = 0.18 + Math.sin(t * 2.1) * 0.08;
      }
    });

    if (scene.userData.sump) scene.userData.sump.rotation.y = Math.sin(t * 0.6) * 0.05;

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();
}

function show2DFallback(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (canvas) canvas.style.display = 'none';
  const fallback = document.getElementById('mine2DFallback');
  if (fallback) fallback.style.display = 'block';
  const hint = document.getElementById('mapFooterHint');
  if (hint) hint.textContent = 'WebGL unavailable — displaying 2D fallback map';
  console.warn('[3D] WebGL unavailable, using 2D fallback');
}

function updateMap3D(MG) {
  if (!MG || !T3D.dashScene) return;
  if (T3D.dashScene.userData.rover) {
    const r = T3D.dashScene.userData.rover;
    if (MG.rover && MG.rover.status === 'INSPECTING') r.userData.target.set(15, 0.6, -13);
    else r.userData.target.copy(r.userData.home);
  }
  if (T3D.fullScene && T3D.fullScene.userData.rover) {
    const fr = T3D.fullScene.userData.rover;
    if (MG.rover && MG.rover.status === 'INSPECTING') fr.userData.target.set(15, 0.6, -13);
    else fr.userData.target.copy(fr.userData.home);
  }
}

function triggerMap3DEvent(key) {
  T3D.events[key] = true;
  console.log('[3D] Event:', key);

  [T3D.dashScene, T3D.fullScene].forEach(scene => {
    if (!scene) return;

    if (key === 'grid') { T3D.events.grid = true; }

    if (key === 'ch4') {
      (scene.userData.hazards || []).forEach(h => {
        if (h.material) h.material.color.setHex(0xff2200);
        if (h.userData) h.userData.baseOpacity = 0.28;
      });
    }

    if (key === 'reset') {
      Object.keys(T3D.events).forEach(k => T3D.events[k] = false);
      (scene.userData.hazards || []).forEach(h => {
        if (h.material) h.material.color.setHex(0xef4444);
        if (h.userData) h.userData.baseOpacity = 0.14;
      });
      if (scene.userData.rover) scene.userData.rover.userData.target.copy(scene.userData.rover.userData.home);
    }

    if (key === 'lhd' && scene.userData.lhd) scene.userData.lhd.userData.patrolProgress += 0.5;
    if (key === 'rover' && scene.userData.rover) scene.userData.rover.userData.target.set(15, 0.6, -13);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('mine3DCanvas')) {
      try { initMap3D(); } catch (e) { console.warn('[3D] init failed:', e); show2DFallback('mine3DCanvas'); }
    }
  });
} else {
  if (document.getElementById('mine3DCanvas')) {
    try { initMap3D(); } catch (e) { console.warn('[3D] init failed:', e); show2DFallback('mine3DCanvas'); }
  }
}

window.initMap3D = initMap3D;
window.initFullMap3D = initFullMap3D;
window.updateMap3D = updateMap3D;
window.triggerMap3DEvent = triggerMap3DEvent;
window.resetFullMapCamera = resetFullMapCamera;
window.T3D = T3D;


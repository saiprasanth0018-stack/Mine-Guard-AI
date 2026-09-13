/* ═══════════════════════════════════════════════════════════════════
   MINEGUARD AI — map_visuals.js (MERGED)
   All 20 visual features in ONE file · SIH26039 · Team LABELX
   Loads AFTER escape_path.js
═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* Guard: only run once */
  if (window.__MG_VISUALS_LOADED__) {
    console.log('[MV] Already loaded — skipping');
    return;
  }
  window.__MG_VISUALS_LOADED__ = true;

  /* ═══════════════ GLOBAL STATE ═══════════════ */
  const MV = {
    workers: [],
    commLines: [],
    blockedMarkers: [],
    fireIcons: [],
    waterIcons: [],
    zoneOverlays: [],
    zoneLabels: [],
    refugeHighlight: null,
    thermalHeat: null,
    lhdTrajectory: null,
    roofPerimeter: null,
    p2vZone: null,
    capLampStrobe: null,
    timerEl: null,
    timerInterval: null,
    timerSecondsLeft: 0,
    animationStarted: false,
    dashBuilt: false,
    fullBuilt: false
  };

  /* ═══════════════ WORKER ROSTER (12) ═══════════════ */
  const WORKERS = {
    W1:  { pos: [-13.0, 0.5,  7.2], status: 'safe',    hr: 78,  spo2: 98, zone: 'Zone 1' },
    W4:  { pos: [-10.5, 0.5,  5.3], status: 'safe',    hr: 74,  spo2: 99, zone: 'Zone 1' },
    W5:  { pos: [  7.0, 0.6, -1.0], status: 'safe',    hr: 79,  spo2: 98, zone: 'Zone 2' },
    W6:  { pos: [ 11.5, 0.6, -5.5], status: 'safe',    hr: 81,  spo2: 97, zone: 'Zone 2' },
    W3:  { pos: [ 15.0, 0.6, -13.2],status: 'trapped', hr: 108, spo2: 94, zone: 'Zone 3' },
    W7:  { pos: [ 16.5, 0.7, -15.5],status: 'safe',    hr: 76,  spo2: 98, zone: 'Zone 3' },
    W8:  { pos: [ 17.5, 0.7, -15.3],status: 'safe',    hr: 83,  spo2: 97, zone: 'Zone 3' },
    W9:  { pos: [ 17.0, 0.7, -16.2],status: 'safe',    hr: 77,  spo2: 98, zone: 'Zone 3' },
    W17: { pos: [ 16.5, 0.8, -13.6],status: 'warn',    hr: 118, spo2: 96, zone: 'Zone 3' },
    W10: { pos: [  3.5, 0.5, 11.5], status: 'safe',    hr: 80,  spo2: 98, zone: 'Zone 4' },
    W11: { pos: [  9.5, 0.5, 11.5], status: 'safe',    hr: 75,  spo2: 99, zone: 'Zone 4' },
    W2:  { pos: [ 16.0, 0.6,  4.4], status: 'safe',    hr: 82,  spo2: 97, zone: 'Zone 5' }
  };

  /* ═══════════════ ZONE DEFINITIONS ═══════════════ */
  const ZONES = [
    { id: 'z1', label: 'ZONE 1 · INTAKE DRIFT',   cx: -12, cz:  6, w: 14, d: 8,  color: 0x0ea5e9 },
    { id: 'z2', label: 'ZONE 2 · INCLINE HAUL',   cx:  10, cz: -5, w: 18, d: 10, color: 0xf59e0b },
    { id: 'z3', label: 'ZONE 3 · LONGWALL FACE',  cx:  16, cz: -14,w: 12, d: 10, color: 0xef4444 },
    { id: 'z4', label: 'ZONE 4 · CROSS-CUT',      cx:  6,  cz: 11, w: 12, d: 6,  color: 0xa855f7 },
    { id: 'z5', label: 'ZONE 5 · REFUGE BAY',     cx:  17, cz:  4, w: 10, d: 5,  color: 0x22c55e }
  ];

  /* ═══════════════ HELPERS ═══════════════ */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function makeLabel(text, opts) {
    opts = opts || {};
    const fontSize = opts.fontSize || 20;
    const fg = opts.fg || '#ffffff';
    const bg = opts.bg || 'rgba(8,19,28,0.9)';
    const border = opts.border || '#38bdf8';
    const pad = opts.pad || 10;
    const scale = opts.scale || 0.02;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold ' + fontSize + 'px "JetBrains Mono", monospace';
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const h = fontSize + pad * 2 + 6;
    canvas.width = w;
    canvas.height = h;

    ctx.fillStyle = bg;
    roundRect(ctx, 1, 1, w - 2, h - 2, 8);
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, w - 2, h - 2, 8);
    ctx.stroke();
    ctx.font = 'bold ' + fontSize + 'px "JetBrains Mono", monospace';
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 1);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false
    }));
    sprite.scale.set(w * scale, h * scale, 1);
    return sprite;
  }

  function colorToHex(n) {
    return '#' + n.toString(16).padStart(6, '0');
  }

  function safeRemove(scene, predicate) {
    if (!scene) return;
    const toRemove = [];
    scene.traverse(obj => { if (predicate(obj)) toRemove.push(obj); });
    toRemove.forEach(obj => { if (obj.parent) obj.parent.remove(obj); });
  }

  /* ═══════════════ 1. ALL 12 WORKERS WITH VITALS ═══════════════ */
  function buildWorkerBody(status) {
    const color = status === 'safe' ? 0x22c55e :
                  status === 'trapped' ? 0xef4444 : 0xf59e0b;
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.55,
      metalness: 0.3, roughness: 0.6
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.94, 12), mat);
    body.position.y = 0.5;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat);
    head.position.y = 1.05;
    group.add(head);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.65, 20),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.6,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);
    group.userData.ring = ring;
    return group;
  }

  function addAllWorkers(scene) {
    Object.keys(WORKERS).forEach(id => {
      const w = WORKERS[id];
      const group = buildWorkerBody(w.status);
      group.position.set(w.pos[0], w.pos[1], w.pos[2]);
      group.userData.entityId = 'worker' + id;
      group.userData.clickable = true;
      group.userData.label = id + ' · ' + w.zone + ' · ' + w.status.toUpperCase();
      group.userData.workerId = id;
      group.userData.status = w.status;
      group.userData.hr = w.hr;
      group.userData.spo2 = w.spo2;

      const borderColor = w.status === 'safe' ? '#22c55e' :
                          w.status === 'trapped' ? '#ef4444' : '#f59e0b';
      const fgColor = w.status === 'safe' ? '#86efac' :
                      w.status === 'trapped' ? '#fecaca' : '#fde68a';

      const vital = makeLabel('HR ' + w.hr + ' · SpO₂ ' + w.spo2 + '%', {
        fontSize: 20, fg: fgColor, border: borderColor,
        bg: 'rgba(8,19,28,0.9)', pad: 8, scale: 0.018
      });
      vital.position.y = 2.1;
      group.add(vital);

      const idLabel = makeLabel(id, {
        fontSize: 22, fg: '#ffffff', border: borderColor,
        bg: 'rgba(8,19,28,0.95)', pad: 8, scale: 0.016
      });
      idLabel.position.y = 1.55;
      group.add(idLabel);

      if (w.status === 'trapped') {
        const badge = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.3),
          new THREE.MeshStandardMaterial({
            color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 1.0
          })
        );
        badge.position.y = 2.7;
        group.add(badge);
        group.userData.badge = badge;
      }

      scene.add(group);
      MV.workers.push(group);
    });
  }

  /* ═══════════════ 2. COMM LINK LINES ═══════════════ */
  function addCommLines(scene) {
    const links = [
      [-14, 1.0, 8,  -13, 0.6, 7],
      [-14, 1.0, 8,  -11, 0.5, 5],
      [-14, 1.0, 8,  -9,  0.5, 4],
      [10, 1.0, -2,  8,   0.6, 0],
      [10, 1.0, -2,  12,  0.6, -6],
      [10, 1.0, -2,  14,  0.6, -10],
      [16, 1.2, -12, 15,  0.7, -13],
      [16, 1.2, -12, 16,  0.8, -14],
      [16, 1.2, -12, 17,  0.7, -15],
      [6, 0.8, 12,   4,   0.5, 11],
      [6, 0.8, 12,   7,   0.5, 12],
      [6, 0.8, 12,   9,   0.5, 12],
      [18, 0.8, 4,   16,  0.6, 4],
      [18, 0.8, 4,   19,  0.6, 4]
    ];

    links.forEach(lnk => {
      const from = new THREE.Vector3(lnk[0], lnk[1], lnk[2]);
      const to = new THREE.Vector3(lnk[3], lnk[4], lnk[5]);

      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([from, to]),
        new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.35 })
      );
      line.userData.isCommLink = true;
      scene.add(line);
      MV.commLines.push(line);

      const mid = from.clone().add(to).multiplyScalar(0.5);
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.75 })
      );
      dot.position.copy(mid);
      dot.userData.isCommLink = true;
      dot.userData.isCommDot = true;
      dot.userData.baseMid = mid.clone();
      scene.add(dot);
      MV.commLines.push(dot);
    });
  }

  /* ═══════════════ 3. BLOCKED MARKER ═══════════════ */
  function addBlockedMarker(scene) {
    const group = new THREE.Group();
    group.position.set(14, 1.5, -8);
    group.visible = false;
    group.userData.isBlockedMarker = true;

    const bar1 = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.15, 0.15),
      new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 1 })
    );
    bar1.rotation.z = Math.PI / 4;
    group.add(bar1);

    const bar2 = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.15, 0.15),
      new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 1 })
    );
    bar2.rotation.z = -Math.PI / 4;
    group.add(bar2);

    const label = makeLabel('🚧 BLOCKED · Tunnel B', {
      fontSize: 18, fg: '#fecaca', border: '#ef4444',
      bg: 'rgba(69,10,10,0.95)', pad: 8, scale: 0.016
    });
    label.position.y = 1.0;
    group.add(label);

    scene.add(group);
    MV.blockedMarkers.push(group);
  }

  /* ═══════════════ 4. FIRE ICON ═══════════════ */
  function addFireIcon(scene) {
    const group = new THREE.Group();
    group.position.set(16, 2.4, -14);
    group.visible = false;
    group.userData.isFireIcon = true;

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 1.4, 12),
      new THREE.MeshBasicMaterial({ color: 0xff6b00, transparent: true, opacity: 0.9 })
    );
    flame.rotation.x = Math.PI;
    group.add(flame);

    const inner = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.8, 10),
      new THREE.MeshBasicMaterial({ color: 0xffd000, transparent: true, opacity: 0.95 })
    );
    inner.rotation.x = Math.PI;
    inner.position.y = -0.2;
    group.add(inner);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xff2200, transparent: true, opacity: 0.25, depthWrite: false
      })
    );
    group.add(glow);
    group.userData.glow = glow;

    const label = makeLabel('🔥 FLAME DETECTED', {
      fontSize: 18, fg: '#fed7aa', border: '#ef4444',
      bg: 'rgba(69,10,10,0.95)', pad: 8, scale: 0.016
    });
    label.position.y = 1.8;
    group.add(label);

    const light = new THREE.PointLight(0xff4400, 0.8, 12);
    light.position.y = 0.5;
    group.add(light);

    scene.add(group);
    MV.fireIcons.push(group);
  }

  /* ═══════════════ 5. WATER ICON ═══════════════ */
  function addWaterIcon(scene) {
    const group = new THREE.Group();
    group.position.set(14, 2.0, -10);
    group.visible = false;
    group.userData.isWaterIcon = true;
    group.userData.baseY = 2.0;

    const drop = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.7),
      new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.85 })
    );
    drop.rotation.x = Math.PI;
    group.add(drop);

    const top = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.5, 12),
      new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.85 })
    );
    top.position.y = 0.35;
    group.add(top);

    const label = makeLabel('💧 SUMP HIGH', {
      fontSize: 18, fg: '#a5f3fc', border: '#00e5ff',
      bg: 'rgba(6,40,50,0.95)', pad: 8, scale: 0.016
    });
    label.position.y = 1.4;
    group.add(label);

    scene.add(group);
    MV.waterIcons.push(group);
  }
  /* ═══════════════ 6. ZONE OVERLAYS + LABELS ═══════════════ */
function addZoneOverlays(scene) {
  ZONES.forEach(z => {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(z.w, z.d),
      new THREE.MeshBasicMaterial({
        color: z.color, transparent: true, opacity: 0.09,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(z.cx, -2.15, z.cz);
    plane.userData.isZoneOverlay = true;
    scene.add(plane);
    MV.zoneOverlays.push(plane);

    const points = [
      new THREE.Vector3(z.cx - z.w / 2, -2.14, z.cz - z.d / 2),
      new THREE.Vector3(z.cx + z.w / 2, -2.14, z.cz - z.d / 2),
      new THREE.Vector3(z.cx + z.w / 2, -2.14, z.cz + z.d / 2),
      new THREE.Vector3(z.cx - z.w / 2, -2.14, z.cz + z.d / 2),
      new THREE.Vector3(z.cx - z.w / 2, -2.14, z.cz - z.d / 2)
    ];
    const border = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: z.color, transparent: true, opacity: 0.7 })
    );
    border.userData.isZoneOverlay = true;
    scene.add(border);
    MV.zoneOverlays.push(border);

    const label = makeLabel(z.label, {
      fontSize: 22, fg: '#ffffff', bg: 'rgba(8,19,28,0.9)',
      border: colorToHex(z.color), pad: 10, scale: 0.018
    });
    label.position.set(z.cx, 5.5, z.cz);
    label.userData.isZoneLabel = true;
    scene.add(label);
    MV.zoneLabels.push(label);
  });
}

/* ═══════════════ 7. REFUGE BAY HIGHLIGHT ═══════════════ */
function addRefugeHighlight(scene) {
  const group = new THREE.Group();
  group.position.set(17, 0.2, 4);
  group.userData.isRefugeHighlight = true;

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(2.8, 32),
    new THREE.MeshBasicMaterial({
      color: 0x22c55e, transparent: true, opacity: 0.35,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  disc.rotation.x = -Math.PI / 2;
  group.add(disc);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.8, 0.12, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.9 })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  group.userData.ring = ring;

  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(2.8, 2.8, 6, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x22c55e, transparent: true, opacity: 0.08,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  cyl.position.y = 3;
  group.add(cyl);

  const label = makeLabel('🏠 REFUGE · 36 h O₂', {
    fontSize: 20, fg: '#86efac', border: '#22c55e',
    bg: 'rgba(6,40,20,0.95)', pad: 10, scale: 0.018
  });
  label.position.y = 4.5;
  group.add(label);

  scene.add(group);
  MV.refugeHighlight = group;
}

/* ═══════════════ 8. THERMAL HEATMAP ═══════════════ */
function addThermalHeatmap(scene) {
  const group = new THREE.Group();
  group.position.set(16, 0.1, -14);
  group.userData.isThermalHeat = true;
  group.visible = false;

  const layers = [
    { r: 4.5, c: 0xff2200, o: 0.22 },
    { r: 3.2, c: 0xff7a00, o: 0.32 },
    { r: 2.0, c: 0xffd000, o: 0.45 }
  ];
  layers.forEach((l, i) => {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(l.r, 40),
      new THREE.MeshBasicMaterial({
        color: l.c, transparent: true, opacity: l.o,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = i * 0.02;
    disc.userData.heatLayer = true;
    disc.userData.baseOpacity = l.o;
    group.add(disc);
  });

  const col = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 3.5, 8, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xff4400, transparent: true, opacity: 0.08,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  col.position.y = 4;
  group.add(col);

  const label = makeLabel('🌡 48 °C THERMAL ANOMALY', {
    fontSize: 18, fg: '#fed7aa', border: '#ff4400',
    bg: 'rgba(69,10,10,0.95)', pad: 8, scale: 0.016
  });
  label.position.y = 6.5;
  group.add(label);

  scene.add(group);
  MV.thermalHeat = group;
}

/* ═══════════════ 9. LHD RUNAWAY TRAJECTORY ═══════════════ */
function addLhdTrajectory(scene) {
  const group = new THREE.Group();
  group.userData.isLhdTrajectory = true;
  group.visible = false;

  const points = [
    new THREE.Vector3(6,  0.6, 2),
    new THREE.Vector3(10, 0.7, -2),
    new THREE.Vector3(14, 0.8, -6),
    new THREE.Vector3(16, 0.9, -10),
    new THREE.Vector3(17, 1.0, -14)
  ];

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineDashedMaterial({
      color: 0xef4444, dashSize: 0.9, gapSize: 0.5,
      transparent: true, opacity: 1.0
    })
  );
  line.computeLineDistances();
  group.add(line);

  const curve = new THREE.CatmullRomCurve3(points);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 60, 0.18, 8, false),
    new THREE.MeshBasicMaterial({
      color: 0xef4444, transparent: true, opacity: 0.22, depthWrite: false
    })
  );
  group.add(tube);

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const dir = to.clone().sub(from).normalize();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 0.9, 8),
      new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.9 })
    );
    cone.position.copy(mid);
    cone.position.y += 0.3;
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    group.add(cone);
  }

  const label = makeLabel('⚠ RUNAWAY · 32 km/h', {
    fontSize: 18, fg: '#fecaca', border: '#ef4444',
    bg: 'rgba(69,10,10,0.95)', pad: 8, scale: 0.016
  });
  label.position.set(12, 3.5, -4);
  group.add(label);

  scene.add(group);
  MV.lhdTrajectory = group;
}

/* ═══════════════ 10. ROOF 60m PERIMETER ═══════════════ */
function addRoofPerimeter(scene) {
  const group = new THREE.Group();
  group.position.set(12, 0.15, -6);
  group.userData.isRoofPerimeter = true;
  group.visible = false;

  const radius = 20;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.3, radius, 64),
    new THREE.MeshBasicMaterial({
      color: 0xef4444, transparent: true, opacity: 0.75,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({
      color: 0xef4444, transparent: true, opacity: 0.06,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.01;
  group.add(fill);

  const pulseRing = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.6, radius - 0.3, 64),
    new THREE.MeshBasicMaterial({
      color: 0xff2200, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  pulseRing.rotation.x = -Math.PI / 2;
  pulseRing.position.y = 0.02;
  group.add(pulseRing);
  group.userData.pulseRing = pulseRing;

  const label = makeLabel('⚠ EVAC PERIMETER · 60 m', {
    fontSize: 20, fg: '#fecaca', border: '#ef4444',
    bg: 'rgba(69,10,10,0.95)', pad: 10, scale: 0.018
  });
  label.position.set(0, 5, 0);
  group.add(label);

  scene.add(group);
  MV.roofPerimeter = group;
}

/* ═══════════════ 11. P2V 6m ZONE ═══════════════ */
function addP2vZone(scene) {
  const group = new THREE.Group();
  group.position.set(8, 0.15, 0);
  group.userData.isP2vZone = true;
  group.visible = false;

  const radius = 6;

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({
      color: 0xfbbf24, transparent: true, opacity: 0.18,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  disc.rotation.x = -Math.PI / 2;
  group.add(disc);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.25, radius, 64),
    new THREE.MeshBasicMaterial({
      color: 0xfbbf24, transparent: true, opacity: 0.95,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  group.add(ring);
  group.userData.ring = ring;

  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.2, 8),
    new THREE.MeshBasicMaterial({ color: 0xef4444 })
  );
  arrow.rotation.x = Math.PI / 2;
  arrow.position.set(0, 1.5, radius);
  group.add(arrow);

  const label = makeLabel('⚠ P2V · 6 m · CAS CLAMPED', {
    fontSize: 18, fg: '#fef3c7', border: '#fbbf24',
    bg: 'rgba(69,50,10,0.95)', pad: 8, scale: 0.016
  });
  label.position.y = 3;
  group.add(label);

  scene.add(group);
  MV.p2vZone = group;
}

/* ═══════════════ 12. CAP-LAMP STROBE ═══════════════ */
function addCapLampStrobe(scene) {
  const group = new THREE.Group();
  group.position.set(15, 0.6, -13.2);
  group.userData.isCapLampStrobe = true;
  group.visible = false;

  const strobe = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0 })
  );
  strobe.position.y = 2.5;
  group.add(strobe);
  group.userData.strobe = strobe;

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(1.0, 20, 16),
    new THREE.MeshBasicMaterial({
      color: 0x22d3ee, transparent: true, opacity: 0.4, depthWrite: false
    })
  );
  glow.position.y = 2.5;
  group.add(glow);
  group.userData.glow = glow;

  const light = new THREE.PointLight(0xffffff, 0, 15);
  light.position.y = 2.5;
  group.add(light);
  group.userData.light = light;

  for (let i = 0; i < 3; i++) {
    const wave = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.0, 32),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee, transparent: true, opacity: 0.6,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    wave.rotation.x = -Math.PI / 2;
    wave.position.y = 0.02 + i * 0.05;
    wave.userData.baseRadius = 0.8;
    wave.userData.waveDelay = i * 0.4;
    group.add(wave);
  }

  const label = makeLabel('🚨 STROBE + 95 dB', {
    fontSize: 18, fg: '#a5f3fc', border: '#22d3ee',
    bg: 'rgba(6,40,50,0.95)', pad: 8, scale: 0.016
  });
  label.position.y = 4;
  group.add(label);

  scene.add(group);
  MV.capLampStrobe = group;
}
/* ═══════════════ 13. ESCAPE TIMER ═══════════════ */
  function createTimerElement() {
    if (document.getElementById('escapeCountdown')) {
      MV.timerEl = document.getElementById('escapeCountdown');
      return;
    }
    const el = document.createElement('div');
    el.id = 'escapeCountdown';
    el.style.cssText = [
      'position: fixed',
      'top: 130px',
      'left: 50%',
      'transform: translateX(-50%)',
      'background: linear-gradient(180deg, rgba(239,68,68,0.95), rgba(127,29,29,0.95))',
      'color: white',
      'padding: 14px 32px',
      'border-radius: 12px',
      'border: 2px solid #fca5a5',
      'font-family: "JetBrains Mono", monospace',
      'font-size: 22px',
      'font-weight: 800',
      'letter-spacing: 3px',
      'z-index: 9500',
      'box-shadow: 0 8px 32px rgba(239,68,68,0.55)',
      'display: none',
      'text-align: center'
    ].join(';');
    el.innerHTML = '⏱ EVACUATION WINDOW<br><span style="font-size:36px;">40:00</span>';
    document.body.appendChild(el);
    MV.timerEl = el;
  }

  function startEscapeTimer(seconds) {
    if (!MV.timerEl) createTimerElement();
    MV.timerSecondsLeft = seconds;
    MV.timerEl.style.display = 'block';
    clearInterval(MV.timerInterval);
    MV.timerInterval = setInterval(() => {
      MV.timerSecondsLeft--;
      if (MV.timerSecondsLeft <= 0) {
        clearInterval(MV.timerInterval);
        MV.timerEl.innerHTML = '⏱ EVACUATION WINDOW<br><span style="font-size:36px;">EXPIRED</span>';
        return;
      }
      const m = Math.floor(MV.timerSecondsLeft / 60);
      const s = MV.timerSecondsLeft % 60;
      MV.timerEl.innerHTML = '⏱ EVACUATION WINDOW<br><span style="font-size:36px;">' +
        String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '</span>';
    }, 1000);
  }

  function stopEscapeTimer() {
    clearInterval(MV.timerInterval);
    if (MV.timerEl) MV.timerEl.style.display = 'none';
  }

  /* ═══════════════ 14. MASTER BUILD ═══════════════ */
  function buildIntoScene(scene, which) {
    if (!scene) return;
    if (which === 'dash' && MV.dashBuilt) return;
    if (which === 'full' && MV.fullBuilt) return;

    try {
      /* Remove old W1/W2/W3 from tunnel_3d.js */
      safeRemove(scene, obj =>
        obj.userData && obj.userData.entityId &&
        ['workerW1', 'workerW2', 'workerW3'].indexOf(obj.userData.entityId) !== -1
      );

      addAllWorkers(scene);
      addCommLines(scene);
      addBlockedMarker(scene);
      addFireIcon(scene);
      addWaterIcon(scene);
      addZoneOverlays(scene);
      addRefugeHighlight(scene);
      addThermalHeatmap(scene);
      addLhdTrajectory(scene);
      addRoofPerimeter(scene);
      addP2vZone(scene);
      addCapLampStrobe(scene);

      if (which === 'dash') MV.dashBuilt = true;
      if (which === 'full') MV.fullBuilt = true;

      console.log('[MV] Built all visuals in', which, 'scene');
    } catch (err) {
      console.error('[MV] Build error:', err);
    }
  }

  /* ═══════════════ 15. TRIGGER HOOK (SINGLE) ═══════════════ */
  const originalTrigger = window.triggerMap3DEvent;

  window.triggerMap3DEvent = function (key) {
    try {
      if (typeof originalTrigger === 'function') originalTrigger(key);
    } catch (e) {
      console.warn('[MV] original trigger error:', e);
    }

    [T3D.dashScene, T3D.fullScene].forEach(scene => {
      if (!scene) return;

      /* Icon visibility */
      MV.fireIcons.forEach(f => { f.visible = (key === 'ch4'); });
      MV.waterIcons.forEach(w => { w.visible = (key === 'grid') || (key === 'mesh'); });
      MV.blockedMarkers.forEach(b => { b.visible = (key === 'mesh'); });

      /* Extra visuals visibility */
      if (MV.thermalHeat)   MV.thermalHeat.visible   = (key === 'ch4');
      if (MV.lhdTrajectory) MV.lhdTrajectory.visible = (key === 'lhd');
      if (MV.roofPerimeter) MV.roofPerimeter.visible = (key === 'roof');
      if (MV.p2vZone)       MV.p2vZone.visible       = (key === 'p2v');
      if (MV.capLampStrobe) MV.capLampStrobe.visible = (key === 'buzzer');

      /* Comm link color shift */
      MV.commLines.forEach(line => {
        if (!line.material) return;
        if (key === 'mesh') {
          line.material.color.setHex(0xef4444);
          line.material.opacity = 0.75;
        } else if (key === 'reset') {
          line.material.color.setHex(0x22d3ee);
          line.material.opacity = 0.35;
        }
      });

      /* LHD turns red on runaway / P2V */
      if (scene.userData && scene.userData.lhd) {
        scene.userData.lhd.traverse(obj => {
          if (obj.isMesh && obj.material && obj.material.emissive) {
            if (key === 'lhd' || key === 'p2v') {
              if (obj.userData._origEmissive === undefined) {
                obj.userData._origEmissive = obj.material.emissive.getHex();
              }
              obj.material.emissive.setHex(0xef4444);
              obj.material.emissiveIntensity = 0.9;
            } else if (obj.userData._origEmissive !== undefined) {
              obj.material.emissive.setHex(obj.userData._origEmissive);
              obj.material.emissiveIntensity = 0.4;
            }
          }
        });
      }

      /* Reset clears everything */
      if (key === 'reset') {
        MV.fireIcons.forEach(f => { f.visible = false; });
        MV.waterIcons.forEach(w => { w.visible = false; });
        MV.blockedMarkers.forEach(b => { b.visible = false; });
        if (MV.thermalHeat)   MV.thermalHeat.visible   = false;
        if (MV.lhdTrajectory) MV.lhdTrajectory.visible = false;
        if (MV.roofPerimeter) MV.roofPerimeter.visible = false;
        if (MV.p2vZone)       MV.p2vZone.visible       = false;
        if (MV.capLampStrobe) MV.capLampStrobe.visible = false;
      }
    });

    /* Timer */
    if (key === 'reset') {
      stopEscapeTimer();
    } else if (key === 'grid') {
      startEscapeTimer(40 * 60);
    } else if (['ch4', 'roof', 'lhd', 'p2v', 'mesh', 'buzzer', 'rover'].indexOf(key) !== -1) {
      startEscapeTimer(20 * 60);
    }
  };

  /* ═══════════════ 16. LIVE HR UPDATE HOOK (SINGLE) ═══════════════ */
  const originalUpdate = window.updateMap3D;

  window.updateMap3D = function (MG) {
    try {
      if (typeof originalUpdate === 'function') originalUpdate(MG);
    } catch (e) { /* silent */ }

    if (!MG || !MG.workers || !Array.isArray(MG.workers)) return;

    MG.workers.forEach(w => {
      MV.workers.forEach(sprite => {
        if (sprite.userData.workerId === w.id) {
          if (w.hr)   sprite.userData.hr   = w.hr;
          if (w.spo2) sprite.userData.spo2 = w.spo2;
        }
      });
    });
  };

  /* ═══════════════ 17. ANIMATION LOOP ═══════════════ */
  function startAnimation() {
    if (MV.animationStarted) return;
    MV.animationStarted = true;

    let t0 = performance.now();

    function tick(now) {
      const time = (now - t0) / 1000;

      /* Worker pulses */
      MV.workers.forEach(w => {
        if (w.userData.ring) {
          const p = 1 + Math.sin(time * 2.2 + w.position.x) * 0.12;
          w.userData.ring.scale.set(p, p, p);
        }
        if (w.userData.badge) w.userData.badge.rotation.y += 0.04;
      });

      /* Comm dots */
      MV.commLines.forEach(obj => {
        if (obj.userData && obj.userData.isCommDot) {
          const p = 1 + Math.sin(time * 3 + obj.userData.baseMid.x) * 0.5;
          obj.scale.set(p, p, p);
          obj.material.opacity = 0.4 + Math.sin(time * 3 + obj.userData.baseMid.x) * 0.35;
        }
      });

      /* Fire flicker */
      MV.fireIcons.forEach(f => {
        if (!f.visible) return;
        f.children.forEach(c => {
          if (c.geometry && c.geometry.type === 'ConeGeometry') {
            const p = 1 + Math.sin(time * 8) * 0.12;
            c.scale.set(p, p + Math.sin(time * 6) * 0.08, p);
          }
        });
        if (f.userData.glow) {
          f.userData.glow.material.opacity = 0.2 + Math.sin(time * 4) * 0.1;
        }
      });

      /* Water bob */
      MV.waterIcons.forEach(w => {
        if (!w.visible) return;
        w.position.y = w.userData.baseY + Math.sin(time * 2) * 0.12;
      });

      /* Blocked pulse */
      MV.blockedMarkers.forEach(b => {
        if (!b.visible) return;
        b.children.forEach(c => {
          if (c.geometry && c.geometry.type === 'BoxGeometry') {
            c.material.opacity = 0.7 + Math.sin(time * 5) * 0.3;
          }
        });
      });

      /* Roof perimeter pulse */
      if (MV.roofPerimeter && MV.roofPerimeter.visible && MV.roofPerimeter.userData.pulseRing) {
        const p = 1 + Math.sin(time * 2.5) * 0.06;
        MV.roofPerimeter.userData.pulseRing.scale.set(p, p, p);
        MV.roofPerimeter.userData.pulseRing.material.opacity =
          0.5 + Math.sin(time * 2.5) * 0.4;
      }

      /* P2V ring pulse */
      if (MV.p2vZone && MV.p2vZone.visible && MV.p2vZone.userData.ring) {
        const p = 1 + Math.sin(time * 4) * 0.05;
        MV.p2vZone.userData.ring.scale.set(p, p, p);
      }

      /* Cap-lamp strobe */
      if (MV.capLampStrobe && MV.capLampStrobe.visible) {
        const flash = Math.sin(time * 12) > 0 ? 1 : 0.2;
        if (MV.capLampStrobe.userData.strobe) {
          MV.capLampStrobe.userData.strobe.material.opacity = flash;
        }
        if (MV.capLampStrobe.userData.glow) {
          MV.capLampStrobe.userData.glow.material.opacity = 0.15 + flash * 0.4;
        }
        if (MV.capLampStrobe.userData.light) {
          MV.capLampStrobe.userData.light.intensity = flash * 1.5;
        }
        MV.capLampStrobe.children.forEach(c => {
          if (c.userData && c.userData.baseRadius !== undefined) {
            const waveT = (time + c.userData.waveDelay) % 1.5;
            const r = c.userData.baseRadius + waveT * 3;
            c.scale.set(r / c.userData.baseRadius, r / c.userData.baseRadius, 1);
            c.material.opacity = Math.max(0, 0.6 - waveT * 0.4);
          }
        });
      }

      /* Thermal heat pulse */
      if (MV.thermalHeat && MV.thermalHeat.visible) {
        MV.thermalHeat.children.forEach(c => {
          if (c.userData && c.userData.heatLayer) {
            c.material.opacity = c.userData.baseOpacity +
              Math.sin(time * 1.5) * 0.08;
          }
        });
      }

      /* Refuge ring rotate */
      if (MV.refugeHighlight && MV.refugeHighlight.userData.ring) {
        MV.refugeHighlight.userData.ring.rotation.z = time * 0.4;
      }

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ═══════════════ 18. INIT ═══════════════ */
  function initMV() {
    if (typeof THREE === 'undefined') {
      console.warn('[MV] THREE not loaded — waiting');
      return;
    }
    if (typeof T3D === 'undefined' || !T3D) {
      console.warn('[MV] T3D not ready — retrying');
      setTimeout(initMV, 300);
      return;
    }

    let attempts = 0;
    const iv = setInterval(() => {
      attempts++;
      if (T3D.dashScene) {
        buildIntoScene(T3D.dashScene, 'dash');
        clearInterval(iv);
        startAnimation();
      } else if (attempts > 50) {
        clearInterval(iv);
        console.warn('[MV] Timeout waiting for dashboard scene');
      }
    }, 200);

    /* Wrap full map init exactly once */
    if (!window.__MG_FULL_INIT_WRAPPED__) {
      window.__MG_FULL_INIT_WRAPPED__ = true;
      const origFull = window.initFullMap3D;
      window.initFullMap3D = function () {
        try {
          if (typeof origFull === 'function') origFull();
        } catch (e) {
          console.warn('[MV] initFullMap3D error:', e);
        }
        setTimeout(() => {
          if (T3D.fullScene) buildIntoScene(T3D.fullScene, 'full');
        }, 600);
      };
    }
  }

  /* ═══════════════ 19. BOOT ═══════════════ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initMV, 900));
  } else {
    setTimeout(initMV, 900);
  }

  window.MV = MV;
  console.log('[MV] map_visuals.js loaded');
})();

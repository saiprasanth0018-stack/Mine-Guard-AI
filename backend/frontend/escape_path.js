/* ═══════════════════════════════════════════════════════════════════
   MINEGUARD AI — escape_path.js
   A* dynamic emergency escape route · SIH26039
   Updated: fires on all cascades · elevated for visibility
═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const escapeState = {
    dashPath: null, fullPath: null,
    dashRunner: null, fullRunner: null,
    dashLabel: null, fullLabel: null
  };

  const PATH_Y_OFFSET = 3.6;   // float above tunnels
  const TUBE_RADIUS = 0.22;    // thicker for visibility
  const DASH_SIZE = 1.2;
  const GAP_SIZE = 0.6;

  /* ─────────────── GRAPH ─────────────── */
  function buildEscapeGraph() {
    return {
      nodes: {
        sha:  { pos: new THREE.Vector3(-20, 0.0,  8),    label: 'Shaft A · Fresh Air' },
        j1:   { pos: new THREE.Vector3( -6, 0.3,  4),    label: 'Junction 1' },
        j2:   { pos: new THREE.Vector3(  6, 0.3,  2),    label: 'Junction 2' },
        j3:   { pos: new THREE.Vector3( 12, 0.4, 10),    label: 'Junction 3' },
        zb3:  { pos: new THREE.Vector3( 16, 0.8, -12),   label: 'Zone 3 · Face End' },
        w3:   { pos: new THREE.Vector3( 15, 0.6, -13.2), label: 'Worker W3 · Start' },
        lhd:  { pos: new THREE.Vector3(  8, 0.4,  0),    label: 'LHD-01 · Start' },
        z4:   { pos: new THREE.Vector3(  6, 0.5, 11),    label: 'Zone 4 · Cross-Cut' },
        ref:  { pos: new THREE.Vector3( 16, 0.6,  4.4),  label: 'Refuge Bay' }
      },
      edges: [
        ['sha', 'j1'],
        ['j1',  'j2'],
        ['j2',  'j3'],
        ['j2',  'zb3'],
        ['zb3', 'w3'],
        ['j3',  'ref'],
        ['j1',  'z4'],
        ['j2',  'lhd'],
        ['lhd', 'zb3']
      ]
    };
  }

  /* ─────────────── A* ─────────────── */
  function heuristic(a, b) { return a.distanceTo(b); }

  function edgeCostWithHazard(from, to, hazards) {
    const base = from.distanceTo(to);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    let penalty = 0;
    hazards.forEach(h => {
      const d = mid.distanceTo(h.pos);
      if (d < h.radius) penalty += h.weight * (1 - d / h.radius);
    });
    return base * (1 + penalty);
  }

  function aStar(graph, startId, goalId, hazards) {
    const neighbors = {};
    graph.edges.forEach(([a, b]) => {
      (neighbors[a] = neighbors[a] || []).push(b);
      (neighbors[b] = neighbors[b] || []).push(a);
    });

    const openSet = new Set([startId]);
    const cameFrom = {};
    const gScore = {};
    const fScore = {};

    Object.keys(graph.nodes).forEach(id => {
      gScore[id] = Infinity;
      fScore[id] = Infinity;
    });
    gScore[startId] = 0;
    fScore[startId] = heuristic(graph.nodes[startId].pos, graph.nodes[goalId].pos);

    while (openSet.size > 0) {
      let current = null, bestF = Infinity;
      openSet.forEach(id => {
        if (fScore[id] < bestF) { bestF = fScore[id]; current = id; }
      });

      if (current === goalId) {
        const path = [current];
        let node = current;
        while (cameFrom[node]) {
          node = cameFrom[node];
          path.unshift(node);
        }
        return path;
      }

      openSet.delete(current);

      (neighbors[current] || []).forEach(neighbor => {
        const cost = edgeCostWithHazard(
          graph.nodes[current].pos,
          graph.nodes[neighbor].pos,
          hazards
        );
        const tentativeG = gScore[current] + cost;
        if (tentativeG < gScore[neighbor]) {
          cameFrom[neighbor] = current;
          gScore[neighbor] = tentativeG;
          fScore[neighbor] = tentativeG + heuristic(
            graph.nodes[neighbor].pos,
            graph.nodes[goalId].pos
          );
          openSet.add(neighbor);
        }
      });
    }
    return null;
  }

  /* ─────────────── LIFT PATH ABOVE TUNNELS ─────────────── */
  function liftPoints(points) {
    return points.map(p => new THREE.Vector3(p.x, p.y + PATH_Y_OFFSET, p.z));
  }

  /* ─────────────── CLEAR ─────────────── */
  function clearEscapePath(which) {
    const scene = which === 'dash' ? T3D.dashScene : T3D.fullScene;
    if (!scene) return;

    const toRemove = [];
    scene.traverse(obj => {
      if (obj.userData && obj.userData.isEscapePath) toRemove.push(obj);
    });
    toRemove.forEach(obj => scene.remove(obj));

    if (which === 'dash') {
      escapeState.dashPath = null;
      escapeState.dashRunner = null;
    } else {
      escapeState.fullPath = null;
      escapeState.fullRunner = null;
    }
  }

  /* ─────────────── HAZARDS PER SCENARIO ─────────────── */
  function hazardsForScenario(key) {
    const center = (x, y, z, w, r) => ({ pos: new THREE.Vector3(x, y, z), weight: w, radius: r });
    switch (key) {
      case 'ch4':    return [center(16, 1.0, -14, 5.0, 9)];
      case 'roof':   return [center(12, 0.6, -6, 4.0, 8)];
      case 'lhd':    return [center(14, 0.6, -4, 4.0, 8)];
      case 'p2v':    return [center(8,  0.4,  0, 3.0, 5)];
      case 'mesh':   return [center(6,  0.5, 11, 3.5, 7)];
      case 'buzzer': return [center(16, 1.0, -14, 4.0, 8)];
      case 'rover':  return [center(16, 1.0, -14, 4.5, 9)];
      case 'grid':   return [center(20, 0.5, -12, 3.0, 7)];
      default:       return [center(16, 1.0, -14, 4.0, 8)];
    }
  }

  /* ─────────────── START NODE PER SCENARIO ─────────────── */
  function startNodeForScenario(key) {
    switch (key) {
      case 'lhd':
      case 'p2v':   return 'lhd';
      case 'mesh':  return 'z4';
      case 'grid':  return 'j3';
      case 'ch4':
      case 'roof':
      case 'buzzer':
      case 'rover':
      default:      return 'w3';
    }
  }

  /* ─────────────── DRAW ─────────────── */
  function drawEscapePath(which, scenarioKey) {
    const scene = which === 'dash' ? T3D.dashScene : T3D.fullScene;
    if (!scene) return;

    clearEscapePath(which);

    const graph = buildEscapeGraph();
    const hazards = hazardsForScenario(scenarioKey || 'ch4');
    const startId = startNodeForScenario(scenarioKey || 'ch4');
    const goalId = 'sha';

    const pathIds = aStar(graph, startId, goalId, hazards);
    if (!pathIds || pathIds.length < 2) {
      console.warn('[Escape] No path found');
      return;
    }

    const rawPoints = pathIds.map(id => graph.nodes[id].pos.clone());
    const points = liftPoints(rawPoints);

    /* ── 1. Outer glow tube (wide, semi-transparent) ── */
    const curve = new THREE.CatmullRomCurve3(points);
    const glowTubeGeo = new THREE.TubeGeometry(curve, 100, TUBE_RADIUS * 2.4, 10, false);
    const glowTubeMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.18,
      depthWrite: false
    });
    const glowTube = new THREE.Mesh(glowTubeGeo, glowTubeMat);
    glowTube.userData.isEscapePath = true;
    glowTube.userData.isGlowTube = true;
    scene.add(glowTube);

    /* ── 2. Main solid tube (bright green, thick) ── */
    const tubeGeo = new THREE.TubeGeometry(curve, 100, TUBE_RADIUS, 10, false);
    const tubeMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    tube.userData.isEscapePath = true;
    scene.add(tube);

    /* ── 3. Dashed overlay for tactical look ── */
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0xd1fae5,
      dashSize: DASH_SIZE,
      gapSize: GAP_SIZE,
      transparent: true,
      opacity: 1.0,
      linewidth: 2
    });
    const line = new THREE.Line(lineGeo, lineMat);
    line.computeLineDistances();
    line.userData.isEscapePath = true;
    scene.add(line);

    /* ── 4. Vertex marker rings at each waypoint ── */
    points.forEach((p, i) => {
      if (i === 0 || i === points.length - 1) return;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.1, 8, 24),
        new THREE.MeshBasicMaterial({
          color: 0xa7f3d0,
          transparent: true,
          opacity: 0.85
        })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(p);
      ring.userData.isEscapePath = true;
      scene.add(ring);
    });

    /* ── 5. Runner sphere ── */
    const runner = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 16, 14),
      new THREE.MeshBasicMaterial({
        color: 0xbbf7d0,
        transparent: true,
        opacity: 1.0
      })
    );
    runner.userData.isEscapePath = true;
    runner.userData.pathPoints = points;
    runner.userData.pathT = 0;
    scene.add(runner);

    /* ── 6. Start marker (red — worker/hazard origin) ── */
    const startMark = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 16, 14),
      new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.9
      })
    );
    startMark.position.copy(points[0]);
    startMark.userData.isEscapePath = true;
    startMark.userData.isStartMark = true;
    scene.add(startMark);

    /* ── 7. End marker (green — safe haven) ── */
    const endMark = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 16, 14),
      new THREE.MeshBasicMaterial({
        color: 0x22c55e,
        transparent: true,
        opacity: 1.0
      })
    );
    endMark.position.copy(points[points.length - 1]);
    endMark.userData.isEscapePath = true;
    endMark.userData.isEndMark = true;
    scene.add(endMark);

    /* ── 8. Halo beacon over end marker ── */
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.7, 32),
      new THREE.MeshBasicMaterial({
        color: 0x22c55e,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.copy(points[points.length - 1]);
    halo.userData.isEscapePath = true;
    halo.userData.isHalo = true;
    scene.add(halo);

    /* Store refs */
    if (which === 'dash') escapeState.dashRunner = runner;
    else escapeState.fullRunner = runner;

    console.log('[Escape] Route for', scenarioKey, ':', pathIds.join(' → '));
  }

  /* ─────────────── ANIMATION ─────────────── */
  function startRunnerLoop() {
    let t0 = performance.now();

    function tick(now) {
      const time = (now - t0) / 1000;

      /* Runner motion */
      [escapeState.dashRunner, escapeState.fullRunner].forEach(runner => {
        if (!runner || !runner.userData.pathPoints) return;
        const pts = runner.userData.pathPoints;
        runner.userData.pathT = (runner.userData.pathT + 0.005) % 1;
        const t = runner.userData.pathT;
        const segs = pts.length - 1;
        const seg = Math.min(Math.floor(t * segs), segs - 1);
        const localT = t * segs - seg;
        const from = pts[seg];
        const to = pts[seg + 1];
        runner.position.lerpVectors(from, to, localT);

        /* Pulsing size */
        const pulse = 1 + Math.sin(time * 6) * 0.15;
        runner.scale.set(pulse, pulse, pulse);
      });

      /* Halo pulse + rotate */
      [T3D.dashScene, T3D.fullScene].forEach(scene => {
        if (!scene) return;
        scene.traverse(obj => {
          if (obj.userData && obj.userData.isHalo) {
            const s = 1 + Math.sin(time * 3) * 0.18;
            obj.scale.set(s, s, s);
            obj.rotation.z = time * 0.8;
          }
          if (obj.userData && obj.userData.isStartMark) {
            const s = 1 + Math.sin(time * 4 + 1) * 0.2;
            obj.scale.set(s, s, s);
          }
          if (obj.userData && obj.userData.isGlowTube) {
            obj.material.opacity = 0.14 + Math.sin(time * 2.5) * 0.06;
          }
        });
      });

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  /* ─────────────── HOOK ALL CASCADES ─────────────── */
  const originalTrigger = window.triggerMap3DEvent;

  window.triggerMap3DEvent = function (key) {
    if (typeof originalTrigger === 'function') {
      originalTrigger(key);
    }

    /* Fires for all emergency cascades */
    const activeScenarios = ['ch4', 'roof', 'lhd', 'p2v', 'mesh', 'buzzer', 'rover', 'grid'];

    if (activeScenarios.indexOf(key) !== -1) {
      setTimeout(() => {
        drawEscapePath('dash', key);
        drawEscapePath('full', key);
      }, 400);
    } else if (key === 'reset') {
      clearEscapePath('dash');
      clearEscapePath('full');
    }
  };

  window.drawEscapePath = drawEscapePath;
  window.clearEscapePath = clearEscapePath;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startRunnerLoop);
  } else {
    startRunnerLoop();
  }

  console.log('[Escape] A* module loaded (all-cascade mode, elevated)');
})();

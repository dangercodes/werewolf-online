// fx3d.js — Lapisan animasi 3D (Three.js) untuk Werewolf Online.
// - Beranda: diorama desa malam low-poly yang perlahan berputar.
// - Layar peran: emblem 3D sesuai peran (serigala / bola kristal / palang /
//   target panah / rumah) dengan tema warna per peran.
// - Momen menerkam & korban: serigala 3D melompat menerkam kamera.
// Semua dibangun dari bentuk dasar (tanpa aset eksternal) dan ringan.
(function () {
  'use strict';

  function noop() {}
  if (!window.THREE) {
    window.FX3D = { available: false, hero: noop, reveal: noop, pounce: noop, stopAll: noop };
    return;
  }

  var active = [];
  var rafId = null;
  var lastT = 0;

  function loop(t) {
    rafId = requestAnimationFrame(loop);
    var dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0.016);
    lastT = t;
    for (var i = active.length - 1; i >= 0; i--) {
      var a = active[i];
      if (a.dead) {
        try { a.renderer.dispose(); } catch (e) {}
        active.splice(i, 1);
        continue;
      }
      a.update(t / 1000, dt);
      a.renderer.render(a.scene, a.camera);
    }
    if (!active.length && rafId) { cancelAnimationFrame(rafId); rafId = null; lastT = 0; }
  }
  function startLoop() { if (!rafId) { lastT = 0; rafId = requestAnimationFrame(loop); } }
  function register(entry) {
    stopCanvas(entry.canvas);
    active.push(entry);
    startLoop();
  }
  function stopCanvas(canvas) {
    for (var i = 0; i < active.length; i++) if (active[i].canvas === canvas) active[i].dead = true;
  }
  function stopAll() { active.forEach(function (a) { a.dead = true; }); }

  function setup(canvas, fov, opts) {
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    } catch (e) {
      return null; // WebGL tidak tersedia — biarkan fallback 2D yang tampil
    }
    if (opts && opts.shadows) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputEncoding = THREE.sRGBEncoding;
    var camera = new THREE.PerspectiveCamera(fov || 45, 1, 0.1, 120);
    var lastW = 0, lastH = 0;
    function resize() {
      var w = canvas.clientWidth || 300, h = canvas.clientHeight || 200;
      if (w !== lastW || h !== lastH) {
        lastW = w; lastH = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    }
    resize();
    return { renderer: renderer, camera: camera, resize: resize };
  }

  var _softTex = null;
  function softTexture() {
    if (_softTex) return _softTex;
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var x = c.getContext('2d');
    var g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    _softTex = new THREE.CanvasTexture(c);
    return _softTex;
  }

  function mat(color, opts) {
    var o = { color: color, roughness: 0.9, metalness: 0.05 };
    if (opts) for (var k in opts) o[k] = opts[k];
    return new THREE.MeshStandardMaterial(o);
  }

  // ---------- Diorama desa malam ----------
  function buildVillage(scene, moonColor) {
    var village = new THREE.Group();
    scene.add(village);
    scene.fog = new THREE.Fog(0x0a0f24, 16, 42);
    scene.add(new THREE.AmbientLight(0x445588, 0.75));
    var dl = new THREE.DirectionalLight(0xaac4ff, 0.55);
    dl.position.set(6, 12, 5);
    dl.castShadow = true;
    dl.shadow.mapSize.set(1024, 1024);
    dl.shadow.camera.left = -13; dl.shadow.camera.right = 13;
    dl.shadow.camera.top = 13; dl.shadow.camera.bottom = -13;
    dl.shadow.camera.far = 32;
    scene.add(dl);

    var ground = new THREE.Mesh(new THREE.CircleGeometry(30, 40), mat(0x131f2e, { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    village.add(ground);

    var moon = new THREE.Mesh(
      new THREE.SphereGeometry(2.1, 24, 24),
      new THREE.MeshBasicMaterial({ color: moonColor || 0xf5f0c8 })
    );
    moon.position.set(-7.5, 7.6, -13);
    village.add(moon);

    // Halo cahaya bulan (sprite gradasi)
    var hcnv = document.createElement('canvas');
    hcnv.width = hcnv.height = 128;
    var hctx = hcnv.getContext('2d');
    var hgrad = hctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    hgrad.addColorStop(0, 'rgba(255,246,210,0.55)');
    hgrad.addColorStop(0.4, 'rgba(255,246,210,0.16)');
    hgrad.addColorStop(1, 'rgba(255,246,210,0)');
    hctx.fillStyle = hgrad;
    hctx.fillRect(0, 0, 128, 128);
    var glowMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(hcnv), transparent: true, depthWrite: false });
    glowMat.color.set(moonColor || 0xf5f0c8);
    var glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(11.5);
    glow.position.copy(moon.position);
    village.add(glow);

    // Kunang-kunang beterbangan
    var ffN = 42, ffPos = new Float32Array(ffN * 3), ffBase = [];
    for (var fi = 0; fi < ffN; fi++) {
      var fbx = (Math.random() - 0.5) * 17, fby = 0.4 + Math.random() * 2.4, fbz = -2 - Math.random() * 8;
      ffBase.push([fbx, fby, fbz, Math.random() * Math.PI * 2]);
      ffPos[fi * 3] = fbx; ffPos[fi * 3 + 1] = fby; ffPos[fi * 3 + 2] = fbz;
    }
    var ffGeo = new THREE.BufferGeometry();
    ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
    var fireflies = new THREE.Points(ffGeo, new THREE.PointsMaterial({ color: 0xffd98a, size: 0.13, map: softTexture(), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    village.add(fireflies);

    // Bintang-bintang
    var n = 260, pos = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 8;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 3 + Math.random() * 15;
      pos[i * 3 + 2] = Math.sin(a) * r - 6;
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    village.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.14 })));

    // Rumah-rumah kecil berjendela menyala
    var spots = [
      [-5.6, -4.6, 0.5, 0x2c3a55], [4.9, -5.6, -0.4, 0x3a3049], [0.4, -7.6, 0.15, 0x2c3a55],
      [-3.4, -8.6, 0.9, 0x40344a], [6.6, -2.2, -0.9, 0x2c3a55], [-7.2, -1.6, 0.3, 0x3a3049]
    ];
    var smokeSrc = [];
    spots.forEach(function (s, hi) {
      var h = new THREE.Group();
      var body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.25, 1.45), mat(s[3]));
      body.position.y = 0.62;
      body.castShadow = true;
      h.add(body);
      var roof = new THREE.Mesh(new THREE.ConeGeometry(1.55, 0.95, 4), mat(0x54303e));
      roof.position.y = 1.72;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      h.add(roof);
      if (hi % 2 === 0) {
        var chim = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.55, 0.24), mat(0x4a4038));
        chim.position.set(0.48, 2.05, 0);
        chim.castShadow = true;
        h.add(chim);
        for (var pk = 0; pk < 7; pk++) smokeSrc.push([s[0] + 0.48, 2.4, s[1], Math.random()]);
      }
      var win = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 0.34),
        new THREE.MeshBasicMaterial({ color: 0xffc978 })
      );
      win.position.set(0.32, 0.66, 0.74);
      h.add(win);
      var win2 = win.clone();
      win2.position.x = -0.34;
      h.add(win2);
      h.position.set(s[0], 0, s[1]);
      h.rotation.y = s[2];
      village.add(h);
    });

    // Pohon pinus
    var treeSpots = [[-8.5, -6], [-1.8, -5.2], [3.4, -8.8], [8.2, -6.4], [-5.2, -10.5], [2.2, -3.4], [-9.4, -2.6], [9.2, -3.4]];
    treeSpots.forEach(function (s) {
      var t = new THREE.Group();
      var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.55, 6), mat(0x3a2a1e));
      trunk.position.y = 0.27;
      t.add(trunk);
      var c1 = new THREE.Mesh(new THREE.ConeGeometry(0.78, 1.5, 8), mat(0x14352a));
      c1.castShadow = true;
      c1.position.y = 1.15;
      t.add(c1);
      var c2 = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.15, 8), mat(0x17402f));
      c2.position.y = 1.95;
      t.add(c2);
      t.position.set(s[0], 0, s[1]);
      village.add(t);
    });

    var smPos = new Float32Array(smokeSrc.length * 3);
    smokeSrc.forEach(function (o, i) { smPos[i * 3] = o[0]; smPos[i * 3 + 1] = o[1]; smPos[i * 3 + 2] = o[2]; });
    var smGeo = new THREE.BufferGeometry();
    smGeo.setAttribute('position', new THREE.BufferAttribute(smPos, 3));
    var smoke = new THREE.Points(smGeo, new THREE.PointsMaterial({ color: 0x9fb0c8, size: 0.55, map: softTexture(), transparent: true, opacity: 0.2, depthWrite: false }));
    village.add(smoke);

    return { moon: moon, group: village, fireflies: { pts: fireflies, base: ffBase }, smoke: { pts: smoke, src: smokeSrc } };
  }

  // Kunang-kunang melayang + asap cerobong naik
  function animateVillage(v, t) {
    if (!v) return;
    if (v.fireflies) {
      var pos = v.fireflies.pts.geometry.attributes.position, base = v.fireflies.base;
      for (var i = 0; i < base.length; i++) {
        var b = base[i];
        pos.array[i * 3] = b[0] + Math.sin(t * 0.5 + b[3]) * 0.4;
        pos.array[i * 3 + 1] = b[1] + Math.sin(t * 0.85 + b[3] * 1.7) * 0.25;
        pos.array[i * 3 + 2] = b[2] + Math.cos(t * 0.4 + b[3]) * 0.3;
      }
      pos.needsUpdate = true;
    }
    if (v.smoke) {
      var sp = v.smoke.pts.geometry.attributes.position, src = v.smoke.src;
      for (var j = 0; j < src.length; j++) {
        var o = src[j], fr = (t * 0.16 + o[3]) % 1;
        sp.array[j * 3] = o[0] + fr * 0.55 + Math.sin(t * 0.9 + o[3] * 9) * 0.08;
        sp.array[j * 3 + 1] = o[1] + fr * 1.8;
        sp.array[j * 3 + 2] = o[2];
      }
      sp.needsUpdate = true;
    }
  }

  // ---------- Serigala low-poly ----------
  function buildWolf(eyeColor) {
    var g = new THREE.Group();
    var fur = mat(0x606a78, { roughness: 0.85 });
    var furDark = mat(0x424b58, { roughness: 0.9 });

    var body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 0.95), fur);
    body.position.y = 1.05;
    g.add(body);

    var headG = new THREE.Group();
    headG.position.set(1.2, 1.58, 0);
    g.add(headG);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.75, 0.8), fur);
    headG.add(head);
    var snout = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.42), furDark);
    snout.position.set(0.62, -0.1, 0);
    headG.add(snout);
    var jaw = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.11, 0.36), furDark);
    jaw.position.set(0.58, -0.33, 0);
    headG.add(jaw);
    var nose = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.17), mat(0x10121a));
    nose.position.set(1.19, -0.02, 0);
    headG.add(nose);
    var mane = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.98, 0.98), furDark);
    mane.position.set(-0.34, 0.03, 0);
    headG.add(mane);
    var muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.34), fur);
    muzzle.position.set(1.02, -0.06, 0);
    headG.add(muzzle);
    [-1, 1].forEach(function (sd) {
      var fang = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 6), mat(0xf8fafc, { roughness: 0.35 }));
      fang.rotation.z = Math.PI;
      fang.position.set(0.84, -0.3, 0.12 * sd);
      headG.add(fang);
    });
    [-1, 1].forEach(function (s) {
      var ear = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.44, 4), furDark);
      ear.position.set(-0.16, 0.56, 0.24 * s);
      ear.rotation.x = 0.15 * s;
      headG.add(ear);
      var eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 8, 8),
        new THREE.MeshBasicMaterial({ color: eyeColor || 0xffd34d })
      );
      eye.position.set(0.43, 0.1, 0.21 * s);
      headG.add(eye);
    });

    var tail = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 0.22), furDark);
    tail.position.set(-1.28, 1.32, 0);
    tail.rotation.z = 0.55;
    g.add(tail);
    var tail2 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.18), furDark);
    tail2.position.set(-1.74, 1.68, 0);
    tail2.rotation.z = 0.95;
    g.add(tail2);

    var legs = [];
    [[0.72, 0.3], [0.72, -0.3], [-0.72, 0.3], [-0.72, -0.3]].forEach(function (p) {
      var leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.85, 0.22), furDark);
      leg.position.set(p[0], 0.42, p[1]);
      g.add(leg);
      legs.push(leg);
    });

    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    g.userData = { jaw: jaw, headG: headG, tail: tail, legs: legs };
    return g;
  }

  // ---------- Emblem per peran ----------
  function buildEmblem(role) {
    var g = new THREE.Group();
    var spin = [];
    if (role === 'werewolf') {
      var w = buildWolf(0xff5544);
      w.position.y = -0.4;
      g.add(w);
      g.userData.wolf = w;
    } else if (role === 'seer') {
      var base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, 0.26, 20), mat(0xa8842f, { metalness: 0.65, roughness: 0.35 }));
      base.position.y = -0.55;
      g.add(base);
      var ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.66, 28, 28),
        new THREE.MeshPhysicalMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.62, roughness: 0.12, metalness: 0, emissive: 0x5b21b6, emissiveIntensity: 0.55 })
      );
      ball.position.y = 0.35;
      g.add(ball);
      var core = new THREE.Mesh(new THREE.SphereGeometry(0.37, 18, 18), new THREE.MeshBasicMaterial({ color: 0xe9d5ff }));
      core.position.y = 0.35;
      g.add(core);
      for (var i = 0; i < 9; i++) {
        var sp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: 0xe9d5ff }));
        sp.userData.a = (i / 9) * Math.PI * 2;
        sp.userData.r = 1.05 + (i % 3) * 0.16;
        sp.userData.y = 0.35;
        g.add(sp);
        spin.push(sp);
      }
    } else if (role === 'doctor') {
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.06, 10, 40), mat(0xf8fafc, { roughness: 0.35 }));
      g.add(ring);
      var c1 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.15, 0.3), mat(0xef4444, { roughness: 0.4 }));
      g.add(c1);
      var c2 = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.36, 0.3), mat(0xef4444, { roughness: 0.4 }));
      g.add(c2);
    } else if (role === 'hunter') {
      var cols = [0xef4444, 0xf8fafc, 0xef4444];
      [0.88, 0.6, 0.32].forEach(function (r, i) {
        var t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.075, 10, 40), mat(cols[i], { roughness: 0.45 }));
        g.add(t);
      });
      var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.9, 8), mat(0xb07a3f, { roughness: 0.6 }));
      shaft.rotation.z = Math.PI / 2 - 0.5;
      shaft.position.set(0.25, 0.35, 0.12);
      g.add(shaft);
      var tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 8), mat(0xd7dde8, { metalness: 0.7, roughness: 0.3 }));
      tip.rotation.z = Math.PI / 2 - 0.5;
      tip.position.set(-0.62, 0.82, 0.12);
      g.add(tip);
    } else {
      // Warga: rumah mini
      var body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.05), mat(0x6f5136));
      body.position.y = -0.15;
      g.add(body);
      var roof = new THREE.Mesh(new THREE.ConeGeometry(1.12, 0.65, 4), mat(0x7c3f2c));
      roof.position.y = 0.62;
      roof.rotation.y = Math.PI / 4;
      g.add(roof);
      var door = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.52, 0.06), mat(0x4a3220));
      door.position.set(0, -0.34, 0.54);
      g.add(door);
      var win = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshBasicMaterial({ color: 0xffc978 }));
      win.position.set(-0.33, 0.02, 0.54);
      g.add(win);
      var chim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.42, 0.2), mat(0x5b4a3a));
      chim.position.set(0.36, 0.85, 0);
      g.add(chim);
    }
    g.userData.spin = spin;
    return g;
  }

  var ROLE_THEME = {
    werewolf: { moon: 0xff7a5c, light: 0xff5544 },
    seer: { moon: 0xf5f0c8, light: 0xa78bfa },
    doctor: { moon: 0xf5f0c8, light: 0x4ade80 },
    hunter: { moon: 0xf5f0c8, light: 0xfbbf24 },
    villager: { moon: 0xf5f0c8, light: 0x93c5fd }
  };

  // ---------- API ----------
  function hero(canvas) {
    if (!canvas) return;
    var s = setup(canvas, 45, { shadows: true });
    if (!s) return;
    var scene = new THREE.Scene();
    var v = buildVillage(scene, 0xf5f0c8);
    s.camera.position.set(0, 3.4, 12.5);
    register({
      canvas: canvas, renderer: s.renderer, scene: scene, camera: s.camera,
      update: function (t) {
        s.resize();
        animateVillage(v, t);
        s.camera.position.x = Math.sin(t * 0.05) * 3.4;
        s.camera.position.y = 3.4 + Math.sin(t * 0.12) * 0.3;
        s.camera.lookAt(0, 1.2, -2);
      }
    });
  }

  function reveal(canvas, role) {
    if (!canvas) return;
    var theme = ROLE_THEME[role] || ROLE_THEME.villager;
    var s = setup(canvas, 45, { shadows: true });
    if (!s) return;
    var scene = new THREE.Scene();
    var v = buildVillage(scene, theme.moon);
    var accent = new THREE.PointLight(theme.light, role === 'werewolf' ? 1.0 : 1.4, 26);
    accent.position.set(0, 3.4, 2.8);
    scene.add(accent);
    var emblem = buildEmblem(role);
    if (role === 'werewolf') { emblem.position.set(0, 0.25, -0.2); emblem.scale.setScalar(1.38); }
    else { emblem.position.set(0, 1.75, -0.6); emblem.scale.setScalar(1.32); }
    scene.add(emblem);
    if (role !== 'seer') emblem.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    var disc = new THREE.Mesh(
      new THREE.CircleGeometry(2.0, 28),
      new THREE.MeshBasicMaterial({ color: theme.light, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(0, 0.03, emblem.position.z);
    scene.add(disc);
    s.camera.position.set(0, 2.5, 8.4);
    var baseY = emblem.position.y;
    register({
      canvas: canvas, renderer: s.renderer, scene: scene, camera: s.camera,
      update: function (t) {
        s.resize();
        animateVillage(v, t);
        s.camera.position.x = Math.sin(t * 0.07) * 1.6;
        s.camera.lookAt(0, 1.4, -1);
        if (role === 'werewolf') {
          var w = emblem.userData.wolf;
          emblem.rotation.y = -1.07 + Math.sin(t * 0.35) * 0.18;
          if (w) {
            w.userData.tail.rotation.z = 0.55 + Math.sin(t * 2.2) * 0.18;
            w.userData.headG.rotation.y = Math.sin(t * 0.5) * 0.16;
          }
        } else if (role === 'hunter') {
          emblem.rotation.y = Math.sin(t * 0.8) * 0.5;
          emblem.position.y = baseY + Math.sin(t * 1.5) * 0.1;
        } else {
          emblem.rotation.y = t * 0.55;
          emblem.position.y = baseY + Math.sin(t * 1.5) * 0.1;
          (emblem.userData.spin || []).forEach(function (sp) {
            var a = sp.userData.a + t * 1.4;
            sp.position.set(Math.cos(a) * sp.userData.r, sp.userData.y + Math.sin(t * 2 + sp.userData.a) * 0.22, Math.sin(a) * sp.userData.r);
          });
        }
      }
    });
  }

  function pounce(canvas) {
    if (!canvas) return;
    var s = setup(canvas, 55);
    if (!s) return;
    var scene = new THREE.Scene();
    var v = buildVillage(scene, 0xff5040);
    v.group.position.z = -11; // desa jauh di latar; kamera di luar desa
    var red = new THREE.PointLight(0xff3324, 0.7, 34);
    red.position.set(0, 3, -13);
    scene.add(red);
    var wolf = buildWolf(0xff4030);
    wolf.rotation.y = -Math.PI / 2 + 0.38; // menghadap kamera, sedikit 3/4 agar berdimensi
    wolf.position.set(0, 0, -23);
    scene.add(wolf);
    var stN = 70, stPos = new Float32Array(stN * 3);
    for (var si = 0; si < stN; si++) {
      stPos[si * 3] = (Math.random() - 0.5) * 11;
      stPos[si * 3 + 1] = Math.random() * 4.6;
      stPos[si * 3 + 2] = -2 - Math.random() * 20;
    }
    var stGeo = new THREE.BufferGeometry();
    stGeo.setAttribute('position', new THREE.BufferAttribute(stPos, 3));
    var streaks = new THREE.Points(stGeo, new THREE.PointsMaterial({ color: 0xff9a70, size: 0.12, map: softTexture(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(streaks);
    s.camera.position.set(0, 1.9, 0);
    s.camera.lookAt(0, 1.6, -10);
    var t0 = null;
    register({
      canvas: canvas, renderer: s.renderer, scene: scene, camera: s.camera,
      update: function (t, dt) {
        s.resize();
        animateVillage(v, t);
        if (t0 === null) t0 = t;
        var el = t - t0;
        var p = Math.min(1, el / 1.5); // fase menerkam 1,5 detik
        var ease = p * p * (3 - 2 * p);
        wolf.position.z = -23 + ease * 14.6;
        wolf.position.y = Math.sin(Math.min(1, p) * Math.PI) * 1.3;
        var sc = 1 + ease * 0.22;
        wolf.scale.setScalar(sc);
        s.camera.fov = 55 + ease * 9;
        s.camera.updateProjectionMatrix();
        var sp2 = streaks.geometry.attributes.position;
        for (var sj = 0; sj < stN; sj++) {
          var nz = sp2.array[sj * 3 + 2] + dt * (10 + ease * 30);
          if (nz > 0.6) { nz = -22; sp2.array[sj * 3] = (Math.random() - 0.5) * 11; sp2.array[sj * 3 + 1] = Math.random() * 4.6; }
          sp2.array[sj * 3 + 2] = nz;
        }
        sp2.needsUpdate = true;
        var open = Math.max(0, Math.sin(Math.min(1, Math.max(0, (p - 0.45) / 0.4)) * Math.PI));
        wolf.userData.jaw.position.y = -0.33 - open * 0.17;
        wolf.userData.headG.rotation.z = -open * 0.22;
        red.intensity = 0.7 + ease * 1.5;
        v.moon.material.color.setHex(0xff5040);
        if (p >= 0.97 && el < 2.5) {
          // Sudah di depan kamera: getar halus + napas
          s.camera.position.x = (Math.random() - 0.5) * 0.07;
          s.camera.position.y = 1.8 + Math.sin(el * 7) * 0.03;
          wolf.userData.headG.rotation.y = Math.sin(el * 1.8) * 0.1;
        } else {
          s.camera.position.x = 0;
          s.camera.position.y = 1.8;
        }
        if (el > 2.6) this.dead = true;
      }
    });
  }

  window.FX3D = { available: true, hero: hero, reveal: reveal, pounce: pounce, stopAll: stopAll, stop: stopCanvas };
})();

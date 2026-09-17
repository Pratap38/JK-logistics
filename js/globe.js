/* JK Logistics — network globe
   Idle: the globe turns slowly. Hover: it swings round to the UK and zooms in,
   revealing the delivery map. Mouse out: it zooms back and resumes turning.
   One orthographic projection throughout — only rotate() and scale() are animated,
   which is what makes it read as flying to the UK rather than swapping images. */
(function () {
  'use strict';

  var canvas = document.getElementById('globe-canvas');
  if (!canvas || !window.d3 || !window.JK_GEO) return;

  var wrap    = canvas.parentElement;
  var tooltip = document.getElementById('globe-tip');
  var hint    = document.getElementById('globe-hint');
  var backBtn = document.getElementById('globe-back');

  var ctx = canvas.getContext('2d');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia('(hover: none)').matches;

  /* ── Where we deliver ─────────────────────────────────────────────── */
  var CITIES = [
    { name: 'Luton',      lon: -0.42, lat: 51.88, hub: true, note: 'Central hub — collections to 16:00' },
    { name: 'Birmingham', lon: -1.90, lat: 52.48, note: 'Next-day, cut-off 18:00' },
    { name: 'London',     lon: -0.13, lat: 51.51, note: 'Next-day, cut-off 18:00' },
    { name: 'Manchester', lon: -2.24, lat: 53.48, note: 'Next-day, cut-off 18:00' },
    { name: 'Leeds',      lon: -1.55, lat: 53.80, note: 'Next-day, cut-off 18:00' },
    { name: 'Sheffield',  lon: -1.47, lat: 53.38, note: 'Next-day, cut-off 18:00' },
    { name: 'Liverpool',  lon: -2.98, lat: 53.41, note: 'Next-day, cut-off 17:30' },
    { name: 'Newcastle',  lon: -1.61, lat: 54.98, note: 'Next-day, cut-off 17:00' },
    { name: 'Nottingham', lon: -1.15, lat: 52.95, note: 'Next-day, cut-off 18:00' },
    { name: 'Leicester',  lon: -1.13, lat: 52.64, note: 'Next-day, cut-off 18:00' },
    { name: 'Bristol',    lon: -2.59, lat: 51.45, note: 'Next-day, cut-off 17:30' },
    { name: 'Southampton',lon: -1.40, lat: 50.91, note: 'Next-day, cut-off 17:00' },
    { name: 'Plymouth',   lon: -4.14, lat: 50.38, note: 'Next-day, cut-off 15:00' },
    { name: 'Exeter',     lon: -3.53, lat: 50.72, note: 'Next-day, cut-off 16:00' },
    { name: 'Norwich',    lon:  1.30, lat: 52.63, note: 'Next-day, cut-off 16:30' },
    { name: 'Hull',       lon: -0.34, lat: 53.74, note: 'Next-day, cut-off 17:00' },
    { name: 'Cardiff',    lon: -3.18, lat: 51.48, note: 'Next-day, cut-off 17:30' },
    { name: 'Swansea',    lon: -3.94, lat: 51.62, note: 'Next-day, cut-off 16:30' },
    { name: 'Glasgow',    lon: -4.25, lat: 55.86, note: 'Next-day, cut-off 16:00' },
    { name: 'Edinburgh',  lon: -3.19, lat: 55.95, note: 'Next-day, cut-off 16:00' },
    { name: 'Aberdeen',   lon: -2.09, lat: 57.15, note: 'Two-day service' },
    { name: 'Inverness',  lon: -4.22, lat: 57.48, note: 'Two-day service' },
    { name: 'Belfast',    lon: -5.93, lat: 54.60, note: 'Two-day service' }
  ];

  /* ── Projection state ─────────────────────────────────────────────── */
  var UK_ROTATE = [3.0, -54.6];     // d3 rotate centres on [-lambda, -phi]
  var IDLE_PHI  = -16;
  var ZOOM      = 10;

  var projection = d3.geoOrthographic().precision(0.4);
  var path = d3.geoPath(projection, ctx);
  var graticule = d3.geoGraticule10();

  var lambda = 40;                  // current rotation
  var phi = IDLE_PHI;
  var t = 0;                        // 0 = globe, 1 = UK
  var target = 0;
  var from = null;                  // rotation captured when a flight starts
  var width = 0, height = 0, radius = 0;
  var hovered = null;
  var locked = false;               // touch devices tap to lock the UK view

  function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }
  function lerp(a, b, p) { return a + (b - a) * p; }

  /* Take the short way round rather than spinning the long way. */
  function shortestTo(a, b) {
    var d = ((b - a + 180) % 360 + 360) % 360 - 180;
    return a + d;
  }

  function resize() {
    var rect = wrap.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(rect.width, 1);
    height = Math.max(rect.height, 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    radius = Math.min(width, height) / 2 - 8;
    draw();
  }

  /* Rotation leads, zoom follows. Ramping both together meant the middle of the
     flight was spent magnifying open ocean; this turns to face the UK first,
     then dives. */
  function rotT()  { return Math.min(t / 0.7, 1); }
  function zoomT() { var z = t <= 0.35 ? 0 : (t - 0.35) / 0.65; return z * z; }

  function fill(geo, colour) {
    ctx.beginPath(); path(geo); ctx.fillStyle = colour; ctx.fill();
  }
  function stroke(geo, colour, w) {
    ctx.beginPath(); path(geo); ctx.strokeStyle = colour; ctx.lineWidth = w; ctx.stroke();
  }

  /* ── Textured earth ───────────────────────────────────────────────────
     The sphere is rendered by inverse-projecting each pixel back to a
     lon/lat and sampling the Blue Marble texture, then shading it with a
     fixed light. Done on a small offscreen buffer and scaled up: at full
     canvas resolution this would be ~1M pixels a frame, which will not hold
     60fps in JS. Geometry and lighting do not depend on rotation, so both
     are precomputed once — only the texture lookup runs per frame. */
  var SPHERE_RES = 320;
  var DEG = Math.PI / 180;

  var tex = null;                       // {data, w, h} once the image decodes
  var buf = document.createElement('canvas');
  var bufCtx = buf.getContext('2d');
  var bufImage = null;
  var geom = null;                      // per-pixel nx / y / cos(c) / shade

  function buildGeometry() {
    var n = SPHERE_RES, total = n * n;
    var nx = new Float32Array(total), ny = new Float32Array(total);
    var cosc = new Float32Array(total), shade = new Float32Array(total);
    var inside = new Uint8Array(total);

    /* Light sits up and to the left, slightly toward the viewer. */
    var lx = -0.42, ly = 0.38, lz = 0.82;
    var ll = Math.sqrt(lx*lx + ly*ly + lz*lz);
    lx /= ll; ly /= ll; lz /= ll;

    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        var i = y * n + x;
        var px = (x + 0.5) / n * 2 - 1;
        var py = -((y + 0.5) / n * 2 - 1);       // flip: canvas y grows downward
        var r2 = px * px + py * py;
        if (r2 > 1) { inside[i] = 0; continue; }
        inside[i] = 1;
        var cz = Math.sqrt(1 - r2);
        nx[i] = px; ny[i] = py; cosc[i] = cz;
        var d = px * lx + py * ly + cz * lz;      // Lambert term
        if (d < 0) d = 0;
        shade[i] = 0.22 + 0.95 * d;               // night side stays faintly lit
      }
    }
    geom = { n: n, nx: nx, ny: ny, cosc: cosc, shade: shade, inside: inside };
    buf.width = buf.height = n;
    bufImage = bufCtx.createImageData(n, n);
  }

  function drawEarth(scale, cx, cy) {
    if (!tex || !geom) return false;
    var n = geom.n, out = bufImage.data;
    var td = tex.data, tw = tex.w, th = tex.h;

    var l0 = -lambda * DEG, p0 = -phi * DEG;     // view centre, radians
    var sinP0 = Math.sin(p0), cosP0 = Math.cos(p0);
    var TWO_PI = Math.PI * 2;

    for (var i = 0, o = 0; i < n * n; i++, o += 4) {
      if (!geom.inside[i]) { out[o + 3] = 0; continue; }

      var px = geom.nx[i], py = geom.ny[i], cz = geom.cosc[i];
      var lat = Math.asin(cz * sinP0 + py * cosP0);
      var lon = l0 + Math.atan2(px, cz * cosP0 - py * sinP0);

      var u = (lon + Math.PI) / TWO_PI;
      u -= Math.floor(u);                         // wrap the antimeridian
      var v = (Math.PI / 2 - lat) / Math.PI;

      var tx = (u * tw) | 0; if (tx >= tw) tx = tw - 1;
      var ty = (v * th) | 0; if (ty >= th) ty = th - 1;
      var ti = (ty * tw + tx) * 4;

      var sh = geom.shade[i];
      out[o]     = td[ti] * sh;
      out[o + 1] = td[ti + 1] * sh;
      out[o + 2] = td[ti + 2] * sh;
      out[o + 3] = 255;
    }

    bufCtx.putImageData(bufImage, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, scale, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(buf, cx - scale, cy - scale, scale * 2, scale * 2);
    ctx.restore();
    return true;
  }

  function drawAtmosphere(cx, cy, r, alpha) {
    ctx.globalAlpha = alpha;
    var g = ctx.createRadialGradient(cx, cy, r * 0.97, cx, cy, r * 1.14);
    g.addColorStop(0, 'rgba(120,190,255,.34)');
    g.addColorStop(0.5, 'rgba(90,160,230,.13)');
    g.addColorStop(1, 'rgba(90,160,230,0)');
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.14, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.globalAlpha = 1;
  }

  function draw() {
    var zt = zoomT();
    var scale = radius * lerp(1, ZOOM, zt);
    projection.rotate([lambda, phi]).scale(scale).translate([width / 2, height / 2]);

    ctx.clearRect(0, 0, width, height);
    var cx = width / 2, cy = height / 2;

    /* The world stays up almost the whole way in — dropping it early left the
       middle of the flight as blank ocean. It only clears once UK detail is in. */
    var worldAlpha = zt < 0.55 ? 1 : Math.max(0, 1 - (zt - 0.55) / 0.3);
    var ukAlpha = zt > 0.3 ? Math.min((zt - 0.3) / 0.35, 1) : 0;

    /* Ocean underneath, so there is still sea once the texture has gone. */
    var sea = ctx.createRadialGradient(cx - scale * 0.3, cy - scale * 0.45, scale * 0.1, cx, cy, scale);
    sea.addColorStop(0, '#16324d');
    sea.addColorStop(1, '#07131f');
    fill({ type: 'Sphere' }, sea);

    if (worldAlpha > 0.01) drawAtmosphere(cx, cy, scale, worldAlpha);

    var painted = false;
    if (worldAlpha > 0.01) {
      ctx.globalAlpha = worldAlpha;
      painted = drawEarth(scale, cx, cy);
      ctx.globalAlpha = 1;
    }

    /* Without the texture (still decoding, or blocked) fall back to flat land. */
    if (worldAlpha > 0.01 && !painted) {
      ctx.globalAlpha = worldAlpha;
      fill(window.JK_GEO.world, 'rgba(150,190,140,.55)');
      ctx.globalAlpha = 1;
    }

    if (worldAlpha > 0.01) {
      ctx.globalAlpha = worldAlpha * 0.22;
      stroke(window.JK_GEO.world, 'rgba(255,255,255,.8)', 0.5);
      ctx.globalAlpha = 1;
      ctx.globalAlpha = worldAlpha * 0.5;
      stroke(graticule, 'rgba(255,255,255,.18)', 0.6);
      ctx.globalAlpha = 1;
    }

    if (ukAlpha > 0.01) {
      ctx.globalAlpha = ukAlpha;
      window.JK_GEO.uk.features.forEach(function (f) {
        var isUK = f.properties.name === 'United Kingdom';
        fill(f, isUK ? 'rgba(198,242,78,.26)' : 'rgba(255,255,255,.10)');
        stroke(f, isUK ? 'rgba(198,242,78,.9)' : 'rgba(255,255,255,.28)', isUK ? 1.4 : 0.7);
      });
      ctx.globalAlpha = 1;
    }

    /* Limb shading + rim keep it reading as a sphere, not a disc. */
    if (zt < 0.9) {
      var a = 1 - zt / 0.9;
      ctx.globalAlpha = a;
      var limb = ctx.createRadialGradient(cx, cy, scale * 0.55, cx, cy, scale);
      limb.addColorStop(0, 'rgba(0,0,0,0)');
      limb.addColorStop(1, 'rgba(0,0,0,.45)');
      ctx.beginPath(); ctx.arc(cx, cy, scale, 0, Math.PI * 2);
      ctx.fillStyle = limb; ctx.fill();
      stroke({ type: 'Sphere' }, 'rgba(180,220,255,.35)', 1);
      ctx.globalAlpha = 1;
    }

    var cityAlpha = zt > 0.55 ? Math.min((zt - 0.55) / 0.3, 1) : 0;
    if (cityAlpha > 0.01) drawCities(cityAlpha);
  }

  function drawCities(alpha) {
    ctx.globalAlpha = alpha;
    ctx.font = '600 12px Inter, system-ui, sans-serif';

    CITIES.forEach(function (c) {
      var p = projection([c.lon, c.lat]);
      if (!p) return;
      c.x = p[0]; c.y = p[1];

      var on = hovered === c;
      var r = c.hub ? 7 : 4.5;

      if (c.hub || on) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], r + (on ? 8 : 6), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(198,242,78,.22)';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(p[0], p[1], on ? r + 1.5 : r, 0, Math.PI * 2);
      ctx.fillStyle = '#C6F24E';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(11,13,12,.85)';
      ctx.stroke();

      if (c.hub || on) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(11,13,12,.75)';
        ctx.strokeText(c.name, p[0] + r + 7, p[1] + 4);
        ctx.fillStyle = '#fff';
        ctx.fillText(c.name, p[0] + r + 7, p[1] + 4);
      }
    });

    ctx.globalAlpha = 1;
  }

  /* Decode the texture, then repaint. */
  (function loadTexture() {
    if (!window.JK_GEO.earth) return;
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      var cc = c.getContext('2d', { willReadFrequently: true });
      cc.drawImage(img, 0, 0);
      try {
        var d = cc.getImageData(0, 0, img.width, img.height);
        tex = { data: d.data, w: img.width, h: img.height };
        buildGeometry();
        draw();
      } catch (e) { tex = null; }     // tainted canvas — keep the flat fallback
    };
    img.src = window.JK_GEO.earth;
  })();

  /* ── Animation loop ───────────────────────────────────────────────── */
  var last = performance.now();
  var progress = 0;            // 0..1 raw; t is the eased version
  var frozen = false;          // set by the test hook
  var DURATION = 1100;

  function frame(now) {
    var dt = Math.min(now - last, 50);
    last = now;

    if (frozen) { requestAnimationFrame(frame); return; }

    var dir = target === 1 ? 1 : -1;
    var moving = (dir === 1 && progress < 1) || (dir === -1 && progress > 0);

    if (moving) {
      progress = Math.max(0, Math.min(1, progress + dir * dt / DURATION));
      t = easeOutCubic(progress);
      if (from) {
        var rt = rotT();
        lambda = lerp(from.lambda, from.lambdaTo, rt);
        phi = lerp(from.phi, UK_ROTATE[1], rt);
      }
      if (progress === 0) { t = 0; from = null; }
    } else if (target === 0 && !reduceMotion) {
      lambda = (lambda + dt * 0.006) % 360;   // ~6 deg/sec
      phi = IDLE_PHI;
    }

    draw();
    requestAnimationFrame(frame);
  }

  /* ── Interaction ──────────────────────────────────────────────────── */
  function flyToUK() {
    if (target === 1) return;
    target = 1;
    from = { lambda: lambda, lambdaTo: shortestTo(lambda, UK_ROTATE[0]), phi: phi };
    if (hint) hint.classList.add('opacity-0');
    if (coarse && backBtn) backBtn.classList.remove('hidden');
  }

  function backToGlobe() {
    if (target === 0) return;
    target = 0;
    hovered = null;
    hideTip();
    if (hint) hint.classList.remove('opacity-0');
    if (backBtn) backBtn.classList.add('hidden');
  }

  function showTip(c) {
    if (!tooltip) return;
    tooltip.innerHTML = '<span class="block font-display text-[15px] font-extrabold tracking-tight">' +
      c.name + '</span><span class="mt-0.5 block text-[13px] text-ink-mute">' + c.note + '</span>';
    tooltip.style.left = c.x + 'px';
    tooltip.style.top = (c.y - 14) + 'px';
    tooltip.classList.remove('hidden');
  }
  function hideTip() { if (tooltip) tooltip.classList.add('hidden'); }

  /* Touch devices tap rather than hover — say so. */
  if (coarse && hint) hint.textContent = 'Tap the globe to see where we deliver';

  if (!coarse) {
    wrap.addEventListener('mouseenter', flyToUK);
    wrap.addEventListener('mouseleave', backToGlobe);
  } else {
    wrap.addEventListener('click', function () { locked ? backToGlobe() : flyToUK(); locked = !locked; });
  }
  if (backBtn) backBtn.addEventListener('click', function (e) {
    e.stopPropagation(); locked = false; backToGlobe();
  });

  /* Keyboard: the canvas is focusable so this works without a mouse. */
  canvas.addEventListener('focus', flyToUK);
  canvas.addEventListener('blur', backToGlobe);

  wrap.addEventListener('mousemove', function (e) {
    if (zoomT() < 0.7) { if (hovered) { hovered = null; hideTip(); } return; }
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;

    var best = null, bestD = 16 * 16;
    CITIES.forEach(function (c) {
      if (c.x == null) return;
      var dx = c.x - mx, dy = c.y - my, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = c; }
    });

    if (best !== hovered) {
      hovered = best;
      best ? showTip(best) : hideTip();
    }
  });

  window.addEventListener('resize', resize);

  /* Expose the state so the view can be driven in tests/screenshots. */
  window.JK_GLOBE = {
    flyToUK: flyToUK,
    backToGlobe: backToGlobe,
    cities: CITIES,
    /* Pin the view at an exact point on the flight, for screenshots and tests. */
    set: function (v) {
      frozen = true;
      progress = v; t = v; from = null;
      var rt = rotT();
      lambda = lerp(40, UK_ROTATE[0], rt);
      phi = lerp(IDLE_PHI, UK_ROTATE[1], rt);
      draw();
    },
    at: function (name) {
      for (var i = 0; i < CITIES.length; i++) if (CITIES[i].name === name) return CITIES[i];
      return null;
    }
  };

  resize();
  if (reduceMotion) {
    lambda = UK_ROTATE[0]; phi = UK_ROTATE[1]; t = 1; target = 1; progress = 1;
    draw();
  } else {
    requestAnimationFrame(frame);
  }
})();

/* ===========================================================================
   reporte-charts.js — Primitivas de gráfico para el reporte de escucha social
   ---------------------------------------------------------------------------
   Escrito a mano en SVG, sin dependencias. Cuatro formas, cada una elegida por
   el trabajo que hace el dato:

     trend()      magnitud en el tiempo, con el periodo anterior de fondo
     donut()      polaridad — una sola pregunta, porcentajes impresos
     ranked()     comparar tamaños — un solo tono, ordenado
     stacked100() comparar proporciones entre grupos de tamaño distinto

   Reglas que se respetan en todas: marcas finas, rejilla discreta, etiqueta
   directa solo donde aporta (nunca un número sobre cada punto), separación de
   2px entre segmentos apilados, cifras con `tabular-nums`, y capa de hover.
   =========================================================================== */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  // Los colores viven en CSS; aquí se leen para que el modo oscuro funcione
  // sin duplicar la paleta en dos sitios.
  function token(root, name, fallback) {
    var v = getComputedStyle(root).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  function el(tag, attrs) {
    var node = document.createElementNS(NS, tag);
    for (var k in attrs) {
      if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    }
    return node;
  }

  // Agrupación manual y no toLocaleString, porque los locales españoles no
  // separan los números de cuatro cifras (5577) y el backend sí lo hace: sin
  // esto, 5,120 en un KPI aparecía como 5120 en el gráfico de al lado.
  // Coma para los miles, punto para los decimales.
  function fmt(n) {
    var s = String(Math.round(Math.abs(Number(n) || 0)));
    var out = '';
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 === 0) out += ',';
      out += s[i];
    }
    return (Number(n) < 0 ? '-' : '') + out;
  }

  function fmtCompact(n) {
    n = Number(n);
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + ' B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + ' M';
    if (Math.abs(n) >= 1e3) return Math.round(n / 1e3) + ' k';
    return String(n);
  }

  function pct(part, whole) {
    return whole ? Math.round((part / whole) * 1000) / 10 : 0;
  }

  // Texto sobre un relleno de color: se elige tinta clara u oscura según la
  // luminancia del fondo. Un blanco fijo sobre el gris neutro se quedaba en
  // ~2.6:1, ilegible, y además fallaba distinto en cada tema.
  function inkOn(hex) {
    var m = String(hex).trim().replace('#', '');
    if (m.length === 3) m = m[0] + m[0] + m[1] + m[1] + m[2] + m[2];
    var r = parseInt(m.slice(0, 2), 16) / 255,
        g = parseInt(m.slice(2, 4), 16) / 255,
        b = parseInt(m.slice(4, 6), 16) / 255;
    if (isNaN(r) || isNaN(g) || isNaN(b)) return '#ffffff';
    function lin(c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    var L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    // Contraste frente a blanco vs frente a casi negro
    var withWhite = 1.05 / (L + 0.05);
    var withInk = (L + 0.05) / 0.0716;
    return withWhite >= withInk ? '#ffffff' : '#101317';
  }

  /* ── Tooltip compartido ─────────────────────────────────────────────── */
  function attachTip(container) {
    var tip = document.createElement('div');
    tip.className = 'rep-tip';
    container.appendChild(tip);
    return {
      show: function (html, x, y) {
        tip.innerHTML = html;
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
        tip.classList.add('on');
      },
      hide: function () { tip.classList.remove('on'); }
    };
  }

  /* =========================================================================
     trend — línea con el periodo anterior como fantasma
     ========================================================================= */
  function trend(container, data) {
    var labels = data.labels || [];
    var cur = data.current || [];
    var prev = data.previous || [];
    if (!labels.length) return;

    var W = 720, H = 260;
    var padL = 52, padR = 18, padT = 22, padB = 34;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var maxV = Math.max.apply(null, cur.concat(prev.length ? prev : [0])) || 1;
    // Techo redondeado hacia arriba: el eje no debe rozar el dato más alto.
    var step = Math.pow(10, Math.floor(Math.log10(maxV)));
    var top = Math.ceil(maxV / (step / 2)) * (step / 2);

    var gold = token(container, '--r-gold', '#a67c00');
    var ghost = token(container, '--r-ghost', '#cdc7b8');
    var line = token(container, '--r-line', '#e4dfd3');
    var ink3 = token(container, '--r-ink-3', '#82868e');
    var ink = token(container, '--r-ink', '#101317');
    var surface = token(container, '--r-surface', '#ffffff');

    var x = function (i) { return padL + (labels.length === 1 ? plotW / 2 : (i * plotW) / (labels.length - 1)); };
    var y = function (v) { return padT + plotH - (v / top) * plotH; };

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    svg.setAttribute('aria-label', 'Evolución por día frente al periodo anterior');

    // Rejilla: tres líneas, discretas
    [0, 0.5, 1].forEach(function (f) {
      var yy = padT + plotH * (1 - f);
      svg.appendChild(el('line', {
        x1: padL, y1: yy, x2: W - padR, y2: yy,
        stroke: line, 'stroke-width': 1
      }));
      var t = el('text', {
        x: padL - 10, y: yy + 4, 'text-anchor': 'end',
        'font-size': 11, fill: ink3
      });
      t.textContent = fmtCompact(top * f);
      svg.appendChild(t);
    });

    // Área bajo la serie actual
    if (cur.length > 1) {
      var areaId = 'grad' + Math.random().toString(36).slice(2, 8);
      var defs = el('defs', {});
      var grad = el('linearGradient', { id: areaId, x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.appendChild(el('stop', { offset: '0%', 'stop-color': gold, 'stop-opacity': .18 }));
      grad.appendChild(el('stop', { offset: '100%', 'stop-color': gold, 'stop-opacity': 0 }));
      defs.appendChild(grad);
      svg.appendChild(defs);

      var areaPts = cur.map(function (v, i) { return x(i) + ',' + y(v); }).join(' ');
      svg.appendChild(el('polygon', {
        points: padL + ',' + (padT + plotH) + ' ' + areaPts + ' ' + x(cur.length - 1) + ',' + (padT + plotH),
        fill: 'url(#' + areaId + ')'
      }));
    }

    // Periodo anterior: discontinua, por detrás
    if (prev.length === labels.length) {
      svg.appendChild(el('polyline', {
        points: prev.map(function (v, i) { return x(i) + ',' + y(v); }).join(' '),
        fill: 'none', stroke: ghost, 'stroke-width': 2, 'stroke-dasharray': '5 4'
      }));
    }

    // Serie actual
    svg.appendChild(el('polyline', {
      points: cur.map(function (v, i) { return x(i) + ',' + y(v); }).join(' '),
      fill: 'none', stroke: gold, 'stroke-width': 2.5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }));

    // Etiqueta directa solo en el máximo — no un número sobre cada punto
    var peak = cur.indexOf(Math.max.apply(null, cur));
    if (peak >= 0) {
      svg.appendChild(el('circle', {
        cx: x(peak), cy: y(cur[peak]), r: 5,
        fill: gold, stroke: surface, 'stroke-width': 2.5
      }));
      var pl = el('text', {
        x: x(peak), y: y(cur[peak]) - 13, 'text-anchor': 'middle',
        'font-size': 12, 'font-weight': 700, fill: ink
      });
      pl.textContent = fmt(cur[peak]);
      svg.appendChild(pl);
    }

    // Eje X: primera, última y algunas intermedias, sin amontonar
    var stride = Math.max(1, Math.ceil(labels.length / 7));
    labels.forEach(function (lab, i) {
      if (i % stride !== 0 && i !== labels.length - 1) return;
      var t = el('text', {
        x: x(i), y: H - 12, 'text-anchor': 'middle',
        'font-size': 11, fill: ink3
      });
      t.textContent = lab;
      svg.appendChild(t);
    });

    // Capa de hover: banda vertical + punto, con área de contacto generosa
    var hover = el('g', { opacity: 0 });
    var vline = el('line', { y1: padT, y2: padT + plotH, stroke: ink, 'stroke-width': 1, 'stroke-dasharray': '3 3' });
    var dot = el('circle', { r: 5, fill: gold, stroke: surface, 'stroke-width': 2.5 });
    hover.appendChild(vline); hover.appendChild(dot);
    svg.appendChild(hover);

    container.appendChild(svg);
    var tip = attachTip(container);

    var capture = el('rect', {
      x: padL, y: padT, width: plotW, height: plotH, fill: 'transparent'
    });
    svg.appendChild(capture);

    function onMove(evt) {
      var box = svg.getBoundingClientRect();
      var px = ((evt.clientX - box.left) / box.width) * W;
      var i = Math.round(((px - padL) / plotW) * (labels.length - 1));
      i = Math.max(0, Math.min(labels.length - 1, i));

      hover.setAttribute('opacity', 1);
      vline.setAttribute('x1', x(i)); vline.setAttribute('x2', x(i));
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(cur[i]));

      var html = '<b>' + fmt(cur[i]) + '</b> · ' + labels[i];
      if (prev.length === labels.length) {
        var d = prev[i] ? Math.round(((cur[i] - prev[i]) / prev[i]) * 1000) / 10 : null;
        html += '<div class="rep-tip-sub">Anterior: ' + fmt(prev[i]) +
                (d === null ? '' : ' · ' + (d >= 0 ? '+' : '') + String(d) + '%') + '</div>';
      }
      tip.show(html, (x(i) / W) * box.width, (y(cur[i]) / H) * box.height);
    }

    svg.addEventListener('mousemove', onMove);
    svg.addEventListener('mouseleave', function () {
      hover.setAttribute('opacity', 0); tip.hide();
    });
  }

  /* =========================================================================
     donut — polaridad
     ========================================================================= */
  function donut(container, segments, centerNote) {
    segments = (segments || []).filter(function (s) { return s.value > 0; });
    if (!segments.length) return;

    var total = segments.reduce(function (a, s) { return a + s.value; }, 0);
    var W = 260, H = 260, cx = W / 2, cy = H / 2, r = 88, sw = 34;
    var C = 2 * Math.PI * r;

    var surface = token(container, '--r-surface', '#ffffff');
    var ink = token(container, '--r-ink', '#101317');
    var ink3 = token(container, '--r-ink-3', '#82868e');

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    svg.setAttribute('aria-label', 'Distribución del sentimiento');

    var g = el('g', { transform: 'translate(' + cx + ',' + cy + ') rotate(-90)' });
    var offset = 0;
    var arcs = [];

    segments.forEach(function (s) {
      var frac = s.value / total;
      // 2px de hueco entre porciones para que se separen sin depender del color
      var len = Math.max(0, frac * C - 2);
      var arc = el('circle', {
        r: r, fill: 'none', stroke: s.color, 'stroke-width': sw,
        'stroke-dasharray': len + ' ' + (C - len),
        'stroke-dashoffset': -offset
      });
      arc.style.cursor = 'pointer';
      g.appendChild(arc);
      arcs.push({ node: arc, seg: s, frac: frac });
      offset += frac * C;
    });
    svg.appendChild(g);

    var dominant = segments.reduce(function (a, b) { return b.value > a.value ? b : a; });
    var big = el('text', {
      x: cx, y: cy - 2, 'text-anchor': 'middle',
      'font-size': 32, 'font-weight': 700, fill: ink
    });
    big.textContent = String(pct(dominant.value, total)) + '%';
    svg.appendChild(big);

    var sub = el('text', { x: cx, y: cy + 20, 'text-anchor': 'middle', 'font-size': 13, fill: ink3 });
    sub.textContent = centerNote || dominant.label.toLowerCase();
    svg.appendChild(sub);

    container.appendChild(svg);
    var tip = attachTip(container);

    arcs.forEach(function (a) {
      a.node.addEventListener('mouseenter', function () {
        arcs.forEach(function (o) { o.node.setAttribute('opacity', o === a ? 1 : .35); });
        var box = svg.getBoundingClientRect();
        tip.show(
          '<b>' + fmt(a.seg.value) + '</b> · ' + String(pct(a.seg.value, total)) + '%' +
          '<div class="rep-tip-sub">' + a.seg.label + '</div>',
          box.width / 2, box.height / 2
        );
      });
      a.node.addEventListener('mouseleave', function () {
        arcs.forEach(function (o) { o.node.setAttribute('opacity', 1); });
        tip.hide();
      });
    });
  }

  /* =========================================================================
     ranked — barras horizontales de un solo tono
     ========================================================================= */
  function ranked(container, items, opts) {
    items = items || [];
    if (!items.length) return;
    opts = opts || {};

    var labelW = opts.labelW || 128;
    var rowH = 30, barH = 13, gap = rowH - barH;
    var W = 520, H = items.length * rowH + 4;
    var maxV = Math.max.apply(null, items.map(function (i) { return i.value; })) || 1;
    var trackW = W - labelW - 60;

    var gold = token(container, '--r-gold', '#a67c00');
    var ghost = token(container, '--r-ghost', '#cdc7b8');
    var ink = token(container, '--r-ink', '#101317');
    var ink3 = token(container, '--r-ink-3', '#82868e');

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    svg.setAttribute('aria-label', opts.aria || 'Ranking por número de menciones');

    container.appendChild(svg);
    var tip = attachTip(container);

    items.forEach(function (item, i) {
      var y0 = i * rowH;
      var isMuted = !!item.muted;

      var lab = el('text', {
        x: 0, y: y0 + barH + 1, 'font-size': 13,
        fill: isMuted ? ink3 : ink
      });
      lab.textContent = item.label;
      svg.appendChild(lab);

      // Anchura mínima de 2px: un dato pequeño debe verse, no desaparecer
      var w = Math.max(2, (item.value / maxV) * trackW);
      var bar = el('rect', {
        x: labelW, y: y0 + gap / 2, width: w, height: barH,
        rx: 3, fill: isMuted ? ghost : gold
      });
      bar.style.cursor = 'pointer';
      svg.appendChild(bar);

      var val = el('text', {
        x: labelW + w + 9, y: y0 + barH + 1,
        'font-size': 12, fill: ink3
      });
      val.textContent = fmt(item.value);
      svg.appendChild(val);

      bar.addEventListener('mouseenter', function () {
        bar.setAttribute('opacity', .78);
        var box = svg.getBoundingClientRect();
        tip.show(
          '<b>' + fmt(item.value) + '</b>' +
          (item.note ? '<div class="rep-tip-sub">' + item.note + '</div>' : ''),
          ((labelW + w / 2) / W) * box.width,
          ((y0 + barH) / H) * box.height
        );
      });
      bar.addEventListener('mouseleave', function () {
        bar.setAttribute('opacity', 1); tip.hide();
      });
    });
  }

  /* =========================================================================
     stacked100 — proporciones comparables entre grupos
     ========================================================================= */
  function stacked100(container, rows, series) {
    rows = rows || [];
    if (!rows.length) return;

    var labelW = 132, rowH = 52, barH = 26;
    var W = 720, H = rows.length * rowH;
    var trackW = W - labelW - 8;

    var ink = token(container, '--r-ink', '#101317');
    var ink3 = token(container, '--r-ink-3', '#82868e');

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    svg.setAttribute('aria-label', 'Reparto de sentimiento dentro de cada red, en porcentaje');

    container.appendChild(svg);
    var tip = attachTip(container);

    rows.forEach(function (row, i) {
      var y0 = i * rowH;
      var total = series.reduce(function (a, s) { return a + (row[s.key] || 0); }, 0);
      if (!total) return;

      var lab = el('text', { x: 0, y: y0 + 18, 'font-size': 14, fill: ink });
      lab.textContent = row.label;
      svg.appendChild(lab);

      var sub = el('text', { x: 0, y: y0 + 34, 'font-size': 11.5, fill: ink3 });
      sub.textContent = fmt(total) + ' menciones';
      svg.appendChild(sub);

      var x0 = labelW;
      series.forEach(function (s) {
        var v = row[s.key] || 0;
        if (!v) return;
        var frac = v / total;
        // 2px de separación entre segmentos: la identidad no depende solo del color
        var w = Math.max(1, frac * trackW - 2);

        var seg = el('rect', { x: x0, y: y0, width: w, height: barH, fill: s.color });
        seg.style.cursor = 'pointer';
        svg.appendChild(seg);

        // Porcentaje impreso dentro del segmento cuando cabe — la separación en
        // deuteranopia es ajustada, así que el número es el que desambigua.
        var p = pct(v, total);
        if (w > 44) {
          var t = el('text', {
            x: x0 + w / 2, y: y0 + barH / 2 + 5, 'text-anchor': 'middle',
            'font-size': 12, 'font-weight': 700, fill: inkOn(s.color)
          });
          t.textContent = String(p) + '%';
          svg.appendChild(t);
        }

        (function (segNode, sName, value, percent) {
          segNode.addEventListener('mouseenter', function () {
            segNode.setAttribute('opacity', .8);
            var box = svg.getBoundingClientRect();
            tip.show(
              '<b>' + String(percent) + '%</b> · ' + fmt(value) +
              '<div class="rep-tip-sub">' + sName + ' · ' + row.label + '</div>',
              ((x0 + w / 2) / W) * box.width, (y0 / H) * box.height
            );
          });
          segNode.addEventListener('mouseleave', function () {
            segNode.setAttribute('opacity', 1); tip.hide();
          });
        })(seg, s.label, v, p);

        x0 += frac * trackW;
      });
    });
  }

  /* =========================================================================
     onThemeChange — los SVG fijan el color al dibujarse
     -------------------------------------------------------------------------
     Los colores se leen de CSS en el momento del render, así que un cambio de
     tema dejaba los gráficos con la paleta anterior sobre el fondo nuevo. Se
     vuelve a dibujar cuando cambia data-theme o la preferencia del sistema.
     ========================================================================= */
  function onThemeChange(redraw) {
    var pending = null;
    function schedule() {
      if (pending) clearTimeout(pending);
      // setTimeout y no requestAnimationFrame: si el navegador no está pintando
      // la pestaña (segundo plano, ventana minimizada) los callbacks de rAF no
      // llegan a ejecutarse nunca, y los gráficos se quedaban con la paleta del
      // tema anterior. El retardo da margen a que se apliquen los tokens nuevos
      // antes de que getComputedStyle los lea.
      pending = setTimeout(function () {
        pending = null;
        redraw();
      }, 30);
    }

    new MutationObserver(schedule).observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme']
    });

    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', schedule);
    else if (mq.addListener) mq.addListener(schedule);
  }

  global.RepCharts = {
    trend: trend,
    donut: donut,
    ranked: ranked,
    stacked100: stacked100,
    onThemeChange: onThemeChange,
    inkOn: inkOn,
    fmt: fmt,
    fmtCompact: fmtCompact
  };
})(window);

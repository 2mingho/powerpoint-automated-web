/*
 * static/js/muelle.js
 * -------------------
 * Movimiento por muelles, gestos y proyeccion de momento.
 *
 * Una transicion CSS o un @keyframes no se pueden agarrar a mitad de vuelo:
 * llevan una duracion fija y van de A a B pase lo que pase. Si el usuario
 * vuelve a tocar el panel mientras se cierra, hay que esperar a que termine.
 * Un muelle no tiene duracion: tiene un destino, y cambiar el destino a mitad
 * de camino conserva la velocidad que ya llevaba. Eso es lo que permite
 * interrumpir y revertir sin costuras.
 *
 * Sin dependencias y sin paso de compilacion: la aplicacion sirve estos
 * ficheros tal cual.
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var SUBPASO = 1 / 240;      // integracion estable aunque caiga un fotograma
  var QUIETO_POS = 0.05;
  var QUIETO_VEL = 0.05;

  /* Respeta la preferencia del sistema. Movimiento reducido no significa
     "sin respuesta": significa llegar al destino sin recorrido vestibular. */
  function movimientoReducido() {
    return window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Muelle de un solo eje.
   *
   * amortiguacion  1.0 = critico, sin rebote. ~0.8 = rebota un poco.
   * respuesta      segundos hasta asentarse. No es una duracion: es la
   *                rapidez con la que persigue el destino.
   */
  function crearMuelle(opciones) {
    var cfg = opciones || {};
    var zeta = cfg.amortiguacion === undefined ? 1 : cfg.amortiguacion;
    var w0 = TAU / (cfg.respuesta === undefined ? 0.4 : cfg.respuesta);
    var alCambiar = cfg.alCambiar || function () {};
    var alTerminar = cfg.alTerminar || function () {};

    var valor = cfg.inicial || 0;
    var velocidad = 0;
    var destino = valor;
    var raf = null;
    var ultimoT = 0;

    function paso(t) {
      raf = null;
      var dt = ultimoT ? Math.min((t - ultimoT) / 1000, 0.064) : SUBPASO;
      ultimoT = t;

      if (movimientoReducido()) {
        valor = destino;
        velocidad = 0;
      } else {
        var restante = dt;
        while (restante > 0) {
          var h = Math.min(restante, SUBPASO);
          var aceleracion = -(w0 * w0) * (valor - destino) - 2 * zeta * w0 * velocidad;
          velocidad += aceleracion * h;
          valor += velocidad * h;
          restante -= h;
        }
      }

      var quieto = Math.abs(valor - destino) < QUIETO_POS
        && Math.abs(velocidad) < QUIETO_VEL;

      if (quieto) {
        valor = destino;
        velocidad = 0;
        alCambiar(valor);
        ultimoT = 0;
        alTerminar(valor);
        return;
      }

      alCambiar(valor);
      raf = requestAnimationFrame(paso);
    }

    function arrancar() {
      if (raf === null) {
        ultimoT = 0;
        raf = requestAnimationFrame(paso);
      }
    }

    return {
      /* Cambiar el destino NO reinicia la velocidad: por eso una reversion no
         choca contra un muro, sigue el impulso que ya traia. */
      irA: function (nuevoDestino, velocidadInicial) {
        destino = nuevoDestino;
        if (velocidadInicial !== undefined) velocidad = velocidadInicial;
        if (valor !== destino || velocidad !== 0) arrancar();
        else alTerminar(valor);
      },
      /* Para agarrar el elemento en pleno vuelo: congela donde esta AHORA,
         no donde deberia acabar. */
      agarrar: function () {
        if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
        ultimoT = 0;
        return { valor: valor, velocidad: velocidad };
      },
      fijar: function (nuevoValor) {
        if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
        ultimoT = 0;
        valor = nuevoValor;
        destino = nuevoValor;
        velocidad = 0;
        alCambiar(valor);
      },
      valorActual: function () { return valor; },
      enMovimiento: function () { return raf !== null; }
    };
  }

  /**
   * Donde acabaria el elemento si se soltara con esa velocidad.
   *
   * Es la deceleracion exponencial del scroll, no la formula de libro
   * v²/(2a). Sirve para elegir el destino MIRANDO HACIA DONDE VA el gesto,
   * no desde donde se solto: un impulso corto y rapido debe lanzar el
   * elemento, no dejarlo donde estaba el dedo.
   */
  function proyectar(velocidad, deceleracion) {
    var d = deceleracion === undefined ? 0.998 : deceleracion;
    return (velocidad / 1000) * d / (1 - d);
  }

  /**
   * Resistencia progresiva al pasarse de un borde.
   *
   * Un tope duro se lee como "se ha colgado". Una resistencia que crece se
   * lee como "responde, pero por aqui no hay mas".
   */
  function gomaElastica(exceso, dimension, constante) {
    var c = constante === undefined ? 0.55 : constante;
    return (exceso * dimension * c) / (dimension + c * Math.abs(exceso));
  }

  /**
   * Seguimiento de un gesto con historial de velocidad.
   *
   * La velocidad se calcula sobre los ultimos ~100 ms y no sobre el ultimo
   * evento: un solo par de puntos da lecturas erraticas justo al soltar, que
   * es cuando mas importa acertar.
   */
  function seguirGesto(elemento, manejadores) {
    var h = manejadores || {};
    var umbral = h.umbral === undefined ? 10 : h.umbral;
    var eje = h.eje || 'y';

    var activo = false;
    var comprometido = false;
    var idPuntero = null;
    var origen = 0;
    var historial = [];

    function coord(e) { return eje === 'x' ? e.clientX : e.clientY; }

    function velocidadActual() {
      if (historial.length < 2) return 0;
      var ultimo = historial[historial.length - 1];
      var primero = historial[0];
      for (var i = historial.length - 1; i >= 0; i--) {
        if (ultimo.t - historial[i].t > 100) break;
        primero = historial[i];
      }
      var dt = (ultimo.t - primero.t) / 1000;
      if (dt <= 0) return 0;
      return (ultimo.p - primero.p) / dt;
    }

    function abajo(e) {
      if (h.puedeEmpezar && !h.puedeEmpezar(e)) return;
      activo = true;
      comprometido = false;
      idPuntero = e.pointerId;
      origen = coord(e);
      historial = [{ p: origen, t: e.timeStamp }];
      elemento.setPointerCapture(e.pointerId);
    }

    function mover(e) {
      if (!activo || e.pointerId !== idPuntero) return;
      var p = coord(e);
      historial.push({ p: p, t: e.timeStamp });
      if (historial.length > 12) historial.shift();

      var delta = p - origen;

      /* Histeresis: hasta que el movimiento no es claro no se compromete la
         direccion, para que un toque con temblor siga siendo un toque. */
      if (!comprometido) {
        if (Math.abs(delta) < umbral) return;
        comprometido = true;
        origen = p - (delta > 0 ? umbral : -umbral);
        delta = p - origen;
        if (h.alEmpezar) h.alEmpezar();
      }

      e.preventDefault();
      if (h.alMover) h.alMover(delta);
    }

    function soltar(e) {
      if (!activo || e.pointerId !== idPuntero) return;
      activo = false;
      idPuntero = null;
      if (!comprometido) return;
      comprometido = false;
      if (h.alSoltar) h.alSoltar(velocidadActual());
    }

    elemento.addEventListener('pointerdown', abajo);
    elemento.addEventListener('pointermove', mover, { passive: false });
    elemento.addEventListener('pointerup', soltar);
    elemento.addEventListener('pointercancel', soltar);

    return function desmontar() {
      elemento.removeEventListener('pointerdown', abajo);
      elemento.removeEventListener('pointermove', mover);
      elemento.removeEventListener('pointerup', soltar);
      elemento.removeEventListener('pointercancel', soltar);
    };
  }

  window.Muelle = {
    crear: crearMuelle,
    proyectar: proyectar,
    gomaElastica: gomaElastica,
    seguirGesto: seguirGesto,
    movimientoReducido: movimientoReducido
  };
})();

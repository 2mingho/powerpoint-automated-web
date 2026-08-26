/*
 * static/js/tour.js
 * -----------------
 * Tour guiado de bienvenida.
 *
 * Dos decisiones que explican casi todo lo demas:
 *
 * 1. Ningun paso se escribe "para el rol X". Cada paso apunta a un selector y
 *    se descarta si ese elemento no esta en la pagina. Como el sidebar, las
 *    barras y los botones ya se dibujan segun has_tool_access, preguntarle al
 *    DOM es preguntar por los permisos sin repetir la regla en JavaScript, que
 *    es donde acabaria quedandose desfasada.
 *
 * 2. El tour cruza paginas. Al terminar los pasos de una, navega a la
 *    siguiente y sigue donde estaba: el recorrido se guarda en sessionStorage
 *    antes de saltar y se recupera al cargar. Un tour que solo cubriera la
 *    pagina de inicio no ensena la plataforma, ensena una pantalla.
 */
(function () {
  'use strict';

  const CLAVE_SESION = 'newlinkTourEnCurso';
  const MARGEN = 12;

  // ─────────────────────────────────────────────────────────────
  // Guion
  // ─────────────────────────────────────────────────────────────
  // destino: a donde navegar para llegar al paso. Se lee del sidebar y no se
  //          escribe a mano: si el enlace no esta, el usuario no tiene esa
  //          herramienta y el paso entero desaparece del recorrido.
  // objetivo:selector del elemento a iluminar. Si no aparece, el globo se
  //          centra en vez de iluminar un hueco.
  // centro:  el paso presenta una pantalla entera, no una pieza de ella;
  //          iluminar el contenido completo no destaca nada.

  const GUION = [
    {
      id: 'bienvenida',
      centro: true,
      titulo: 'Bienvenido a Newlink',
      texto: 'Este recorrido dura menos de dos minutos y solo te muestra lo que tú puedes usar. ' +
             'Puedes salir cuando quieras y retomarlo después desde tu menú de usuario.',
    },
    {
      id: 'navegacion',
      objetivo: '#sidebarNav',
      titulo: 'Todo lo tuyo está aquí',
      texto: 'Esta columna es el índice de la plataforma. Solo aparecen las herramientas ' +
             'habilitadas para tu cuenta: si algo no está en la lista, no es que esté escondido, ' +
             'es que no lo tienes asignado.',
    },
    {
      id: 'espacios',
      objetivo: '.sidebar-spaces',
      titulo: 'Dos espacios, no una lista larga',
      texto: '«Trabajo» es tu día a día: tareas y solicitudes. «Herramientas» son los procesos ' +
             'de datos y reportes. Cambiar de espacio no te saca de donde estás.',
    },
    {
      id: 'notificaciones',
      objetivo: '#notifToggle',
      titulo: 'Aquí te enteras de todo',
      texto: 'Te avisamos cuando te asignan una tarea, cuando cambia algo que observas y cuando ' +
             'alguien acepta o rechaza una solicitud tuya. Pulsar una notificación te lleva ' +
             'directamente a lo que la provocó.',
    },
    {
      id: 'buscador',
      centro: true,
      titulo: 'Un atajo que sirve para todo',
      texto: 'Pulsa Ctrl + K (o ⌘ + K) en cualquier pantalla para buscar una tarea, saltar a una ' +
             'herramienta o crear algo nuevo sin navegar. Si solo recuerdas un atajo, que sea este.',
    },

    // ── Trabajo: tareas ──
    {
      id: 'ir-tareas',
      destino: '.sidebar-item[aria-label="Mis tareas"]',
      objetivo: '.tasks-views',
      titulo: 'Tus tareas, en tres vistas',
      texto: '«Hoy» es con lo que abres el día: lo que vence y lo que está en marcha. ' +
             '«Calendario» es la misma información repartida en el mes. ' +
             '«Observadas» son las que sigues sin que sean tuyas.',
    },
    {
      id: 'nueva-tarea',
      objetivo: '#btnNewTask',
      titulo: 'Crear cuesta un título',
      texto: 'Solo el título es obligatorio. El resto — cliente, fechas, recurrencia — está ' +
             'plegado en acordeones porque hace falta en menos de un tercio de las tareas. ' +
             'Puedes completarlo más tarde.',
    },
    {
      id: 'observadas',
      objetivo: '.tasks-view-btn[data-vista="observadas"]',
      titulo: 'Observar es seguir sin cargar',
      texto: 'Abre cualquier tarea y verás la pestaña «Observadores». Observar una tarea te avisa ' +
             'de sus cambios y comentarios, pero no te la asigna ni suma a tu carga de trabajo. ' +
             'Sirve para enterarte de lo que hace otra unidad sin meterte en medio.',
    },
    {
      id: 'solicitar',
      objetivo: '#btnRequestTask',
      titulo: 'Pedir trabajo a otra unidad',
      texto: 'Cuando algo no te toca a ti, no lo asignas: lo solicitas. La unidad destino decide ' +
             'si lo acepta y a quién se lo da, y tú quedas como observador de la tarea que salga.',
    },

    // ── Trabajo: solicitudes ──
    {
      id: 'ir-solicitudes',
      destino: '.sidebar-item[aria-label="Solicitudes"]',
      objetivo: '.tr-tabs',
      titulo: 'Lo que pides y lo que te piden',
      texto: '«Recibidas» es tu bandeja de decisiones: aceptar convierte la solicitud en una tarea ' +
             'real de tu unidad, rechazar exige una razón que le llega a quien la pidió. ' +
             '«Enviadas» es para dar seguimiento a las tuyas.',
    },

    // ── Trabajo: equipo (solo quien supervisa) ──
    {
      id: 'equipo',
      destino: '.sidebar-item[aria-label="Mi equipo"], .sidebar-item[aria-label="Todo el equipo"]',
      centro: true,
      titulo: 'El panel de tu equipo',
      texto: 'Abre con las cifras que importan — vencidas, bloqueadas, quién va más cargado — ' +
             'antes que con los filtros. Los filtros siguen ahí para cuando busques algo concreto.',
    },

    // ── Herramientas ──
    {
      id: 'reportes',
      destino: '.sidebar-item[aria-label="Generar Reporte"]',
      centro: true,
      titulo: 'Reportes a partir de tus datos',
      texto: 'Cargas los archivos de la campaña y la plataforma arma el reporte: métricas, ' +
             'gráficos y análisis. Lo revisas en la web y lo exportas a PDF cuando esté listo.',
    },
    {
      id: 'clasificacion',
      destino: '.sidebar-item[aria-label="Clasificacion"]',
      centro: true,
      titulo: 'Clasificar menciones',
      texto: 'Organiza las menciones por temática, tono y plataforma sin hacerlo a mano. ' +
             'Es el paso previo habitual a generar un reporte.',
    },
    {
      id: 'union',
      destino: '.sidebar-item[aria-label="Union de Archivos"]',
      centro: true,
      titulo: 'Unir archivos sueltos',
      texto: 'Combina varios archivos de redes y prensa en una sola fuente con el mismo formato, ' +
             'para que el resto de herramientas puedan leerlos.',
    },
    {
      id: 'analisis',
      destino: '.sidebar-item[aria-label="Analisis Rapido"]',
      centro: true,
      titulo: 'Una mirada rápida a un CSV',
      texto: 'Sube cualquier CSV y obtienes su resumen estadístico en segundos, sin montar un ' +
             'reporte completo.',
    },
    {
      id: 'mis-reportes',
      destino: '.sidebar-item[aria-label="Mis Reportes"]',
      centro: true,
      titulo: 'Donde queda lo que generaste',
      texto: 'Todo lo que produces se guarda aquí para volver a descargarlo. No hace falta que ' +
             'te lo guardes por tu cuenta.',
    },

    // ── Administración ──
    {
      id: 'admin',
      destino: '.sidebar-item[aria-label="Admin Panel"]',
      centro: true,
      titulo: 'El panel de administración',
      texto: 'Desde aquí se dan de alta usuarios y permisos, se asignan las unidades y sus líderes ' +
             'en «Organización», y se editan los estados y prioridades de tarea. Si alguien no ' +
             'puede solicitar o aceptar trabajo, casi siempre se arregla en «Organización».',
    },

    {
      id: 'final',
      centro: true,
      titulo: 'Eso es todo',
      texto: 'Ya conoces las piezas. Si quieres repetir el recorrido, está en tu menú de usuario, ' +
             'arriba a la derecha, como «Ver el tour».',
      ultimo: true,
    },
  ];

  // ─────────────────────────────────────────────────────────────
  // Estado
  // ─────────────────────────────────────────────────────────────

  let pasos = [];
  let indice = 0;
  let capa = null;
  let recuadro = null;
  let globo = null;
  let objetivoActual = null;

  function rutaActual() {
    return window.location.pathname;
  }

  function guardar(estado) {
    try {
      sessionStorage.setItem(CLAVE_SESION, JSON.stringify(estado));
    } catch (e) { /* sin sessionStorage el tour funciona, pero no cruza paginas */ }
  }

  function leerGuardado() {
    try {
      const crudo = sessionStorage.getItem(CLAVE_SESION);
      return crudo ? JSON.parse(crudo) : null;
    } catch (e) {
      return null;
    }
  }

  function olvidar() {
    try { sessionStorage.removeItem(CLAVE_SESION); } catch (e) { /* nada */ }
  }

  // ─────────────────────────────────────────────────────────────
  // Preparacion del guion
  // ─────────────────────────────────────────────────────────────

  /* Un paso entra si su destino existe (o no lo necesita) — es decir, si el
     usuario tiene la herramienta — y si en su pagina hay algo que ensenar. Del
     destino solo se guarda el href, no el enlace, porque tras navegar el enlace
     original ya no existe. */
  function prepararGuion() {
    return GUION.map(function (paso) {
      const copia = Object.assign({}, paso);
      if (paso.destino) {
        const enlace = document.querySelector(paso.destino);
        if (!enlace || !enlace.getAttribute('href')) return null;
        copia.url = enlace.getAttribute('href');
      }
      return copia;
    }).filter(Boolean);
  }

  function esDeEstaPagina(paso) {
    if (!paso.url) return true;
    // Comparacion por ruta: los enlaces del sidebar no llevan query.
    return paso.url.split('?')[0].replace(/\/$/, '') === rutaActual().replace(/\/$/, '');
  }

  // ─────────────────────────────────────────────────────────────
  // Pintado
  // ─────────────────────────────────────────────────────────────

  function construirCapa() {
    capa = document.createElement('div');
    capa.className = 'tour-capa';
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-modal', 'true');
    capa.setAttribute('aria-labelledby', 'tourTitulo');

    recuadro = document.createElement('div');
    recuadro.className = 'tour-foco';
    capa.appendChild(recuadro);

    globo = document.createElement('div');
    globo.className = 'tour-globo';
    globo.innerHTML =
      '<p class="tour-contador" id="tourContador"></p>' +
      '<h2 class="tour-titulo" id="tourTitulo"></h2>' +
      '<p class="tour-texto" id="tourTexto"></p>' +
      '<div class="tour-acciones">' +
      '  <button type="button" class="tour-salir" id="tourSalir">Salir del tour</button>' +
      '  <div class="tour-avance">' +
      '    <button type="button" class="btn btn-secondary btn-sm" id="tourAtras">Atrás</button>' +
      '    <button type="button" class="btn btn-primary btn-sm" id="tourSiguiente">Siguiente</button>' +
      '  </div>' +
      '</div>';
    capa.appendChild(globo);

    document.body.appendChild(capa);
    document.body.classList.add('tour-activo');

    globo.querySelector('#tourSalir').addEventListener('click', function () { terminar(false); });
    globo.querySelector('#tourAtras').addEventListener('click', atras);
    globo.querySelector('#tourSiguiente').addEventListener('click', siguiente);

    // Pulsar fuera no cierra: cerrar el tour sin querer es exactamente el
    // accidente que deja a alguien sin saber usar la plataforma.
    document.addEventListener('keydown', alPulsarTecla);
    window.addEventListener('resize', recolocarPronto);
    window.addEventListener('scroll', recolocarPronto, true);
  }

  function alPulsarTecla(evento) {
    if (!capa) return;
    if (evento.key === 'Escape') { terminar(false); }
    else if (evento.key === 'ArrowRight') { siguiente(); }
    else if (evento.key === 'ArrowLeft') { atras(); }
  }

  function pintarPaso() {
    const paso = pasos[indice];
    if (!paso) { terminar(true); return; }

    objetivoActual = paso.centro ? null : document.querySelector(paso.objetivo);

    globo.querySelector('#tourTitulo').textContent = paso.titulo;
    globo.querySelector('#tourTexto').textContent = paso.texto;
    globo.querySelector('#tourContador').textContent = 'Paso ' + (indice + 1) + ' de ' + pasos.length;
    globo.querySelector('#tourAtras').disabled = indice === 0;
    globo.querySelector('#tourSiguiente').textContent = paso.ultimo ? 'Terminar' : 'Siguiente';

    // Solo se desplaza si hace falta, y de golpe. Con desplazamiento suave el
    // recuadro se medía antes de que el scroll terminara y aparecía un instante
    // sobre el sitio equivocado antes de corregirse.
    if (objetivoActual && !estaEnPantalla(objetivoActual)) {
      objetivoActual.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
    // Un fotograma para que el scroll haya movido el elemento antes de medirlo.
    window.requestAnimationFrame(recolocar);
  }

  // El scroll con captura llega una vez por contenedor y por rueda; recolocar
  // mide el globo, lo que fuerza un layout. Se agrupa en un fotograma.
  let recoloqueEncolado = false;
  function recolocarPronto() {
    if (recoloqueEncolado) return;
    recoloqueEncolado = true;
    window.requestAnimationFrame(function () {
      recoloqueEncolado = false;
      recolocar();
    });
  }

  function estaEnPantalla(elemento) {
    const caja = elemento.getBoundingClientRect();
    return caja.top >= 0 && caja.left >= 0 &&
           caja.bottom <= window.innerHeight && caja.right <= window.innerWidth;
  }

  function recolocar() {
    if (!capa || !globo) return;

    if (!objetivoActual) {
      recuadro.classList.add('tour-foco-oculto');
      globo.classList.add('tour-globo-centro');
      globo.style.top = '';
      globo.style.left = '';
      return;
    }

    recuadro.classList.remove('tour-foco-oculto');
    globo.classList.remove('tour-globo-centro');

    const caja = objetivoActual.getBoundingClientRect();
    recuadro.style.top = (caja.top - 6) + 'px';
    recuadro.style.left = (caja.left - 6) + 'px';
    recuadro.style.width = (caja.width + 12) + 'px';
    recuadro.style.height = (caja.height + 12) + 'px';

    const anchoGlobo = globo.offsetWidth;
    const altoGlobo = globo.offsetHeight;

    // Debajo si cabe; si no, encima; y si tampoco, al lado. Con el sidebar,
    // que es alto y estrecho, el unico sitio razonable es a la derecha.
    let arriba = caja.bottom + MARGEN;
    let izquierda = caja.left;

    if (caja.height > window.innerHeight * 0.6) {
      arriba = Math.max(MARGEN, caja.top);
      izquierda = caja.right + MARGEN;
    } else if (arriba + altoGlobo > window.innerHeight - MARGEN) {
      arriba = caja.top - altoGlobo - MARGEN;
    }

    izquierda = Math.min(izquierda, window.innerWidth - anchoGlobo - MARGEN);
    izquierda = Math.max(MARGEN, izquierda);
    arriba = Math.min(arriba, window.innerHeight - altoGlobo - MARGEN);
    arriba = Math.max(MARGEN, arriba);

    globo.style.top = arriba + 'px';
    globo.style.left = izquierda + 'px';
  }

  // ─────────────────────────────────────────────────────────────
  // Avance
  // ─────────────────────────────────────────────────────────────

  function siguiente() {
    const paso = pasos[indice];
    if (paso && paso.ultimo) { terminar(true); return; }

    const proximo = pasos[indice + 1];
    if (!proximo) { terminar(true); return; }

    if (!esDeEstaPagina(proximo)) {
      // Se apunta donde quedamos y se navega: al cargar la pagina destino el
      // tour se reanuda solo.
      guardar({ id: proximo.id });
      window.location.href = proximo.url;
      return;
    }

    indice += 1;
    pintarPaso();
  }

  function atras() {
    if (indice === 0) return;
    const anterior = pasos[indice - 1];
    if (!esDeEstaPagina(anterior)) {
      guardar({ id: anterior.id });
      window.location.href = anterior.url || '/';
      return;
    }
    indice -= 1;
    pintarPaso();
  }

  function terminar(completado) {
    olvidar();
    if (capa) {
      capa.remove();
      capa = null;
      globo = null;
      recuadro = null;
    }
    document.body.classList.remove('tour-activo');
    document.removeEventListener('keydown', alPulsarTecla);
    window.removeEventListener('resize', recolocarPronto);
    window.removeEventListener('scroll', recolocarPronto, true);
    objetivoActual = null;

    // Salir a medias tambien cuenta como visto: repetir la oferta en cada
    // carga seria una trampa, no una ayuda. Se recupera desde el menu.
    fetch('/api/tour/completado', { method: 'POST' }).catch(function () { /* da igual */ });

    if (completado && typeof window.appNotify === 'function') {
      window.appNotify({ type: 'success', message: 'Tour terminado. Está en tu menú de usuario si quieres repetirlo.' });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Arranque
  // ─────────────────────────────────────────────────────────────

  function arrancar(desdeId) {
    pasos = prepararGuion();
    if (!pasos.length) return;

    indice = 0;
    if (desdeId) {
      const encontrado = pasos.findIndex(function (p) { return p.id === desdeId; });
      if (encontrado >= 0) indice = encontrado;
    }

    // Si el paso al que llegamos no tiene su elemento en pantalla —una pagina
    // que tardo en montar su interfaz, o un boton que no existe para este
    // usuario— se avanza hasta el primero que si esta, en vez de ensenar un
    // recuadro vacio.
    while (pasos[indice] && !pasos[indice].centro && !document.querySelector(pasos[indice].objetivo)) {
      if (!esDeEstaPagina(pasos[indice + 1] || {})) break;
      indice += 1;
    }
    if (!pasos[indice]) { terminar(true); return; }

    construirCapa();
    pintarPaso();
  }

  window.iniciarTour = function () {
    if (capa) return;
    olvidar();
    fetch('/api/tour/reiniciar', { method: 'POST' })
      .catch(function () { /* si falla, el tour se ve igual */ })
      .finally(function () { arrancar(null); });
  };

  document.addEventListener('DOMContentLoaded', function () {
    const raiz = document.body;
    if (!raiz) return;

    const pendiente = leerGuardado();
    if (pendiente && pendiente.id) {
      // La interfaz de tareas y solicitudes se monta con JavaScript despues de
      // cargar; medio segundo evita iluminar un hueco.
      window.setTimeout(function () { arrancar(pendiente.id); }, 400);
      return;
    }

    if (raiz.dataset.tourPendiente === '1') {
      window.setTimeout(function () { arrancar(null); }, 400);
    }
  });

  document.addEventListener('click', function (evento) {
    const disparador = evento.target.closest('[data-iniciar-tour]');
    if (!disparador) return;
    evento.preventDefault();
    window.iniciarTour();
  });
})();

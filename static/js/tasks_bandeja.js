/* ═══════════════════════════════════════════════════════
   BANDEJA DE TAREAS (Propuesta A: bandeja enfocada + panel lateral)

   Sustituye a la antigua vista Hoy, cuyas filas solo sabian abrir el modal
   grande: para marcar algo como hecho habia que entrar, buscar el estado,
   guardar y salir. Aqui la fila se completa con un clic, el detalle se edita
   al lado sin perder la lista y una tarea nueva cuesta una linea de texto.

   Va en su propio fichero porque tasks.js ya pasa de 2900 lineas y esto es
   una pieza con estado propio. Lo que ya existia (peticiones, modal completo,
   configuracion de estados) se toma de window.TareasApp, que publica
   tasks.js, en vez de copiarlo.
   ═══════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {
  const app = window.TareasApp;
  const shell = document.getElementById('tasksShell');
  const lista = document.getElementById('todayGroups');
  const panel = document.getElementById('tasksDetailPanel');
  // Sin tasks.js (o sin la bandeja en la plantilla) no hay nada que montar.
  if (!app || !shell || !lista || !panel) return;

  const requestJson = app.requestJson;
  const escapeHtml = app.escapeHtml;
  const notify = app.notify;

  function leerJson(texto, porDefecto) {
    try {
      const valor = JSON.parse(texto || '');
      return valor == null ? porDefecto : valor;
    } catch (e) {
      return porDefecto;
    }
  }

  // Estados y prioridades son configurables por unidad: nunca se escriben a
  // mano aqui salvo como ultimo recurso si la plantilla no los trajera.
  const HOY = app.HOY;
  const FINALES = Array.isArray(app.FINAL_STATUSES) ? app.FINAL_STATUSES : [];
  const ESTADO_INICIAL = app.INITIAL_STATUS || 'Pendiente';
  const ESTADO_HECHO = FINALES[0] || 'Completado';
  const PRIORIDAD_DEFECTO = app.DEFAULT_PRIORITY || 'Media';
  const ESTADOS = leerJson(shell.dataset.statuses, [ESTADO_INICIAL, ESTADO_HECHO]);
  const PRIORIDADES = leerJson(shell.dataset.priorities, [PRIORIDAD_DEFECTO]);
  const MI_ID = Number(shell.dataset.userId) || 0;
  const nodoPersonas = document.getElementById('tasksAreaUsers');
  const PERSONAS = leerJson(nodoPersonas ? nodoPersonas.textContent : '', []);

  const movil = window.matchMedia('(max-width: 768px)');
  const CLAVE_ALCANCE = 'nl-bandeja-alcance';
  const CLAVE_PISTA = 'nl-bandeja-pista-vista';
  const ALCANCES = ['mine', 'created', 'unit'];
  const DURACION_AVISO = 6000;

  // ─── Preferencias ───
  // localStorage puede lanzar en modo privado o con almacenamiento lleno: la
  // preferencia es una comodidad, nunca un motivo para que la pagina falle.
  function leerPreferencia(clave) {
    try { return localStorage.getItem(clave); } catch (e) { return null; }
  }
  function guardarPreferencia(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch (e) { /* modo privado */ }
  }

  // ─── Fechas ───
  // Todo parte de HOY, que fija el servidor en la zona de negocio. Se formatea
  // en local y no con toISOString(): este pasa a UTC y en husos positivos
  // devolvia el dia anterior.
  function aFecha(iso) {
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function aIso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function sumarDias(iso, dias) {
    const d = aFecha(iso);
    if (!d) return iso;
    d.setDate(d.getDate() + dias);
    return aIso(d);
  }
  function diasEntre(desdeIso, hastaIso) {
    const a = aFecha(desdeIso);
    const b = aFecha(hastaIso);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000);
  }
  function etiquetaVencimiento(dueIso) {
    if (!dueIso || !HOY) return '';
    const dias = diasEntre(HOY, dueIso);
    if (dias === 0) return 'hoy';
    if (dias === 1) return 'mañana';
    if (dias === -1) return 'venció ayer';
    if (dias < -1) return `venció hace ${Math.abs(dias)} d`;
    const d = aFecha(dueIso);
    if (!d) return dueIso;
    if (dias < 7) return d.toLocaleDateString('es-DO', { weekday: 'long' });
    return d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short' });
  }
  function fechaLarga(iso) {
    const d = aFecha(iso);
    if (!d) return iso || '';
    return d.toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  // "Esta semana" en la creacion movil: el viernes de esta semana, que es lo
  // que la gente quiere decir. Si hoy es viernes, hoy; en fin de semana ya no
  // queda viernes en esta semana y se usa el siguiente (el boton cambia su
  // rotulo a "Próximo viernes" para no prometer otra cosa).
  function proximoViernes() {
    const d = aFecha(HOY);
    if (!d) return HOY;
    return sumarDias(HOY, (5 - d.getDay() + 7) % 7);
  }
  function esFinDeSemana() {
    const d = aFecha(HOY);
    return !!d && (d.getDay() === 0 || d.getDay() === 6);
  }

  function normalizar(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

  function esFinal(estadoTarea) { return FINALES.includes(estadoTarea); }
  function esVencida(t) { return !esFinal(t.status) && !!t.due_date && !!HOY && t.due_date < HOY; }

  // Solo para pintar la franja: si la unidad usa otros nombres, todo cae en
  // el tono neutro, que sigue leyendose.
  function claseDePrioridad(prioridad) {
    const p = normalizar(prioridad);
    if (p === 'alta' || p === 'urgente') return 'prio-alta';
    if (p === 'baja') return 'prio-baja';
    return 'prio-media';
  }
  function claseDeEstado(estadoTarea) {
    if (esFinal(estadoTarea)) return 'is-final';
    if (estadoTarea === ESTADO_INICIAL) return 'is-inicial';
    return 'is-curso';
  }
  function iniciales(nombre) {
    const partes = String(nombre || '').trim().split(/[\s._-]+/).filter(Boolean);
    if (!partes.length) return '?';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[1][0]).toUpperCase();
  }
  function nombreDePersona(id) {
    if (Number(id) === MI_ID) return 'ti';
    const p = PERSONAS.find(function (u) { return Number(u.id) === Number(id); });
    return p ? p.username : '';
  }

  /* ═══ Estado ═══ */
  const estado = {
    alcance: ALCANCES.includes(leerPreferencia(CLAVE_ALCANCE)) ? leerPreferencia(CLAVE_ALCANCE) : 'mine',
    tareas: new Map(),
    // Lo completado en esta visita sigue a la vista hasta recargar: si la fila
    // desapareciera al marcarla, no habria donde pulsar para deshacer un error.
    completadasSesion: new Map(),
    seleccion: null,
    detalle: null,
    checklist: [],
    comentarios: [],
    cargandoDetalle: false,
    // 'Esta semana' y 'Completadas' abren plegadas: la vista de entrada debe
    // responder que hay que hacer ahora, no mostrar los siete dias de golpe.
    plegados: new Set(['semana', 'completadas']),
    turnoLista: 0,
    turnoDetalle: 0,
    // Cada tarea guarda sus cambios en fila: dos clics seguidos enviarian el
    // mismo expected_updated_at y el segundo chocaria con el primero (409).
    colas: new Map(),
    pendientes: new Map(),
    abortarDetalle: null,
    focoAlCerrar: null
  };

  function obtener(id) {
    id = Number(id);
    if (estado.tareas.has(id)) return estado.tareas.get(id);
    if (estado.completadasSesion.has(id)) return estado.completadasSesion.get(id);
    if (estado.detalle && Number(estado.detalle.id) === id) return estado.detalle;
    return null;
  }

  // El PUT devuelve la tarea sin los contadores de la bandeja: se fusiona
  // sobre lo que ya habia en vez de reemplazarlo, o se perderian el avance
  // del checklist y los comentarios de la fila.
  function fusionar(id, datos) {
    id = Number(id);
    [estado.tareas, estado.completadasSesion].forEach(function (mapa) {
      if (mapa.has(id)) mapa.set(id, Object.assign({}, mapa.get(id), datos));
    });
    if (estado.detalle && Number(estado.detalle.id) === id) {
      estado.detalle = Object.assign({}, estado.detalle, datos);
    }
    const t = obtener(id);
    if (t && esFinal(t.status) && !estado.completadasSesion.has(id) && estado.tareas.has(id)) {
      estado.completadasSesion.set(id, t);
    }
    if (t && !esFinal(t.status) && estado.completadasSesion.has(id)) {
      // Una tarea vencida y completada ya no vuelve en la recarga (overdue=1
      // excluye los estados finales): al reabrirla solo existe aqui. Se pasa a
      // la lista normal o la fila desapareceria y su Deshacer no encontraria
      // nada que cambiar.
      if (!estado.tareas.has(id)) estado.tareas.set(id, estado.completadasSesion.get(id));
      estado.completadasSesion.delete(id);
    }
  }

  /* ═══ Lista ═══ */

  function pedirTareas(url) {
    // fetch y no requestJson: hace falta el codigo HTTP para no confundir un
    // 429 o un 500 con una agenda vacia.
    return fetch(url).then(function (respuesta) {
      if (!respuesta.ok) {
        const error = new Error('http ' + respuesta.status);
        error.estado = respuesta.status;
        throw error;
      }
      return respuesta.json();
    }).then(function (datos) {
      if (!Array.isArray(datos)) throw new Error('respuesta inesperada');
      return datos;
    });
  }

  function cargarLista(opciones) {
    const opts = opciones || {};
    if (!HOY) return Promise.resolve();
    const turno = ++estado.turnoLista;
    lista.setAttribute('aria-busy', 'true');

    const finSemana = sumarDias(HOY, 7);
    const comun = `scope=${encodeURIComponent(estado.alcance)}&counts=1`;
    return Promise.all([
      pedirTareas(`/api/tasks?overdue=1&${comun}`),
      pedirTareas(`/api/tasks?start=${HOY}&end=${finSemana}&${comun}`)
    ]).then(function (respuestas) {
      if (turno !== estado.turnoLista) return;
      const mapa = new Map();
      respuestas[0].concat(respuestas[1]).forEach(function (t) {
        if (!t || t.id == null) return;
        const id = Number(t.id);
        // Una respuesta que salio antes de un PUT puede traer un updated_at
        // viejo: si se pisara la cache, el siguiente cambio daria un 409 falso.
        // Mientras haya cambios en cola, o si la cache es mas reciente, manda
        // la cache.
        const enCache = obtener(id);
        if (enCache && ((estado.pendientes.get(id) || 0) > 0
            || String(enCache.updated_at || '') > String(t.updated_at || ''))) {
          mapa.set(id, enCache);
        } else {
          mapa.set(id, t);
        }
      });
      estado.tareas = mapa;
      // Lo completado en la visita se refresca con lo que diga el servidor si
      // sigue llegando; si no, se queda la ultima copia conocida.
      mapa.forEach(function (t, id) {
        if (esFinal(t.status)) estado.completadasSesion.set(id, t);
        else estado.completadasSesion.delete(id);
      });
      pintarLista();
      if (estado.seleccion && !opts.sinDetalle) cargarDetalle(estado.seleccion, { silencioso: true });
    }).catch(function (error) {
      if (turno !== estado.turnoLista) return;
      lista.innerHTML = '<p class="today-error">'
        + '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> '
        + escapeHtml(error && error.estado === 429
          ? 'Demasiadas peticiones seguidas. Espera unos segundos y pulsa Actualizar.'
          : 'No se pudo cargar tu trabajo. Comprueba la conexión y pulsa Actualizar.')
        + '</p>';
      lista.setAttribute('aria-busy', 'false');
    });
  }

  const ORDEN_PRIORIDAD = {};
  PRIORIDADES.forEach(function (p, i) { ORDEN_PRIORIDAD[p] = i; });

  function ordenar(a, b) {
    const fa = a.due_date || '9999';
    const fb = b.due_date || '9999';
    if (fa !== fb) return fa < fb ? -1 : 1;
    const pa = ORDEN_PRIORIDAD[a.priority] != null ? ORDEN_PRIORIDAD[a.priority] : 99;
    const pb = ORDEN_PRIORIDAD[b.priority] != null ? ORDEN_PRIORIDAD[b.priority] : 99;
    // Las prioridades llegan de mayor a menor: indice bajo, mas urgente.
    if (pa !== pb) return pa - pb;
    return String(a.title || '').localeCompare(String(b.title || ''), 'es');
  }

  function grupoDe(t) {
    if (esFinal(t.status)) return 'completadas';
    if (esVencida(t)) return 'vencidas';
    if (t.due_date === HOY) return 'hoy';
    return 'semana';
  }

  function fila(t) {
    const id = Number(t.id);
    const hecha = esFinal(t.status);
    const vencida = esVencida(t);
    const seleccionada = estado.seleccion === id;
    const clases = ['bandeja-fila', claseDePrioridad(t.priority)];
    if (hecha) clases.push('is-done');
    if (vencida) clases.push('is-overdue');
    if (seleccionada) clases.push('is-selected');

    const meta = [];
    if (t.client) meta.push(escapeHtml(t.client));
    const total = Number(t.checklist_total) || 0;
    if (total) meta.push(`Checklist ${Number(t.checklist_done) || 0}/${total}`);
    const comentarios = Number(t.comments_count) || 0;
    if (comentarios) meta.push(`${comentarios} com.`);
    if (t.creator_id && Number(t.creator_id) !== MI_ID && t.creator_name) meta.push('de ' + escapeHtml(t.creator_name));

    const titulo = escapeHtml(t.title || '(sin título)');
    const asignado = t.assignee_name ? escapeHtml(t.assignee_name) : '';

    return ''
      + `<li class="${clases.join(' ')}" data-tarea="${id}">`
      // Acciones del deslizamiento: ocultas a la tecnologia de asistencia
      // mientras no se ven; las mismas acciones estan en la hoja de detalle.
      +   '<div class="bandeja-fila-acciones" aria-hidden="true">'
      +     '<button type="button" class="bandeja-fila-accion is-manana" data-accion="manana" tabindex="-1">'
      +       '<i class="fa-regular fa-calendar" aria-hidden="true"></i> Mañana</button>'
      +     `<button type="button" class="bandeja-fila-accion is-hecha" data-accion="hecha" tabindex="-1">`
      +       `<i class="fa-solid ${hecha ? 'fa-rotate-left' : 'fa-check'}" aria-hidden="true"></i> ${hecha ? 'Reabrir' : 'Hecha'}</button>`
      +   '</div>'
      +   '<div class="bandeja-fila-frente">'
      +     `<button type="button" class="bandeja-check" data-accion="completar" aria-pressed="${hecha}"`
      +       ` aria-label="${hecha ? 'Reabrir' : 'Marcar como hecha'}: ${titulo}">`
      +       '<i class="fa-solid fa-check" aria-hidden="true"></i>'
      +     '</button>'
      +     `<button type="button" class="bandeja-fila-btn" data-accion="abrir" aria-controls="tasksDetailPanel"${seleccionada ? ' aria-current="true"' : ''}>`
      +       '<span class="bandeja-fila-main">'
      +         `<span class="bandeja-fila-titulo">${titulo}</span>`
      +         (meta.length ? `<span class="bandeja-fila-meta">${meta.join(' · ')}</span>` : '')
      +       '</span>'
      +       `<span class="bandeja-pill ${claseDeEstado(t.status)}">${escapeHtml(t.status || '')}</span>`
      +       `<span class="bandeja-fila-prio">${escapeHtml(t.priority || PRIORIDAD_DEFECTO)}</span>`
      +       `<span class="bandeja-fila-cuando">${escapeHtml(etiquetaVencimiento(t.due_date))}</span>`
      +       (asignado
              ? `<span class="bandeja-avatar" title="${asignado}" aria-hidden="true">${escapeHtml(iniciales(t.assignee_name))}</span>`
                + `<span class="visually-hidden">Asignada a ${asignado}</span>`
              : '')
      +     '</button>'
      +   '</div>'
      + '</li>';
  }

  const GRUPOS = [
    { clave: 'vencidas', titulo: 'Vencidas', destacado: true },
    { clave: 'hoy', titulo: 'Hoy' },
    { clave: 'semana', titulo: 'Esta semana', plegable: true },
    { clave: 'completadas', titulo: 'Completadas', plegable: true }
  ];

  function textoVacio() {
    if (estado.alcance === 'created') return 'No has creado nada que venza en los próximos siete días.';
    if (estado.alcance === 'unit') return 'Tu unidad no tiene nada vencido ni pendiente para los próximos siete días.';
    return 'Nada vencido ni pendiente para los próximos siete días. Escribe arriba para añadir una tarea, o abre el calendario para ver más adelante.';
  }

  // Recuerda que tenia el foco para devolverlo tras repintar: sin esto,
  // completar una fila con el teclado mandaba el foco al <body>.
  function capturarFoco(contenedor) {
    const activo = document.activeElement;
    if (!activo || !contenedor.contains(activo)) return null;
    const filaEl = activo.closest('[data-tarea]');
    return {
      tarea: filaEl ? filaEl.dataset.tarea : null,
      accion: activo.dataset.accion || null,
      plegar: activo.dataset.plegar || null,
      foco: activo.dataset.foco || null,
      id: activo.id || null
    };
  }
  function restaurarFoco(contenedor, foco) {
    if (!foco) return;
    let el = null;
    if (foco.id) el = document.getElementById(foco.id);
    else if (foco.plegar) el = contenedor.querySelector(`[data-plegar="${foco.plegar}"]`);
    else if (foco.foco) el = contenedor.querySelector(`[data-foco="${CSS.escape(foco.foco)}"]`);
    else if (foco.tarea && foco.accion) {
      el = contenedor.querySelector(`[data-tarea="${foco.tarea}"] [data-accion="${foco.accion}"]`);
    }
    if (el && contenedor.contains(el)) el.focus({ preventScroll: true });
  }

  function pintarLista() {
    const foco = capturarFoco(lista);
    const porGrupo = { vencidas: [], hoy: [], semana: [], completadas: [] };
    const vistas = new Set();
    estado.tareas.forEach(function (t, id) {
      vistas.add(id);
      porGrupo[grupoDe(t)].push(t);
    });
    estado.completadasSesion.forEach(function (t, id) {
      if (!vistas.has(id)) porGrupo.completadas.push(t);
    });

    const html = GRUPOS.map(function (g) {
      const tareas = porGrupo[g.clave].sort(ordenar);
      if (!tareas.length) return '';
      const plegado = g.plegable && estado.plegados.has(g.clave);
      const idLista = `bandejaGrupo-${g.clave}`;
      return ''
        + `<section class="today-group${g.destacado ? ' is-vencidas' : ''}${plegado ? ' is-collapsed' : ''}" data-grupo="${g.clave}">`
        +   '<div class="today-group-head">'
        +     `<h3 class="today-group-title">${escapeHtml(g.titulo)}</h3>`
        +     `<span class="today-group-count">${tareas.length}</span>`
        +     (g.plegable
                ? `<button type="button" class="today-group-toggle" data-plegar="${g.clave}" aria-expanded="${!plegado}" aria-controls="${idLista}">`
                  + (plegado ? 'desplegar' : 'plegar') + '</button>'
                : '')
        +   '</div>'
        +   `<ul class="today-list bandeja-filas" id="${idLista}">${tareas.map(fila).join('')}</ul>`
        + '</section>';
    }).join('');

    const soloCompletadas = !porGrupo.vencidas.length && !porGrupo.hoy.length && !porGrupo.semana.length;
    lista.innerHTML = (soloCompletadas ? `<p class="today-empty">${escapeHtml(textoVacio())}</p>` : '') + html;
    lista.setAttribute('aria-busy', 'false');
    filaAbierta = null;
    restaurarFoco(lista, foco);
  }

  /* ═══ Guardar cambios ═══ */

  // Cambio parcial con concurrencia optimista. Se pinta antes de que conteste
  // el servidor (la respuesta al pulsar es inmediata) y se deshace si falla.
  // Devuelve { tarea, previo } o null si no se aplico.
  function guardarCambio(id, cambios) {
    id = Number(id);
    const anterior = estado.colas.get(id) || Promise.resolve();
    estado.pendientes.set(id, (estado.pendientes.get(id) || 0) + 1);
    const siguiente = anterior.catch(function () {}).then(function () {
      const t = obtener(id);
      if (!t) return null;
      const previo = {};
      Object.keys(cambios).forEach(function (k) { previo[k] = t[k]; });

      fusionar(id, cambios);
      repintarTodo();

      const cuerpo = Object.assign({}, cambios, { expected_updated_at: t.updated_at || '' });
      return requestJson(`/api/tasks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo)
      }).then(function (data) {
        if (data && data.success && data.task) {
          // Un estado que el servidor no reconoce se ignora con un 200: se
          // comprueba aqui para no pintar como hecho algo que no lo esta.
          if ('status' in cambios && data.task.status !== cambios.status) {
            fusionar(id, data.task);
            repintarTodo();
            notify('error', 'Ese estado ya no existe en tu unidad. Recarga la página.');
            return null;
          }
          fusionar(id, data.task);
          repintarTodo();
          app.refrescarCalendario();
          return { tarea: obtener(id), previo: previo };
        }
        if (data && data.task) {
          // 409: otra persona la cambio. Se trae lo que hay de verdad.
          fusionar(id, data.task);
          repintarTodo();
          notify('warning', 'La tarea cambió, se recargó.');
          if (estado.seleccion === id) cargarDetalle(id, { silencioso: true });
          return null;
        }
        fusionar(id, previo);
        repintarTodo();
        notify('error', (data && data.error) || 'No se pudo guardar el cambio.');
        return null;
      }).catch(function () {
        fusionar(id, previo);
        repintarTodo();
        notify('error', 'Error de conexión. El cambio no se guardó.');
        return null;
      });
    });
    estado.colas.set(id, siguiente);
    siguiente.finally(function () {
      const quedan = (estado.pendientes.get(id) || 1) - 1;
      if (quedan > 0) estado.pendientes.set(id, quedan);
      else estado.pendientes.delete(id);
    });
    return siguiente;
  }

  function tituloCorto(t) {
    const titulo = String((t && t.title) || 'Tarea');
    return titulo.length > 60 ? titulo.slice(0, 57) + '…' : titulo;
  }

  function ofrecerDeshacer(resultado, mensaje) {
    if (!resultado) return;
    const id = Number(resultado.tarea.id);
    mostrarAviso(mensaje, function () {
      // El previo se envia con el updated_at que devolvio el PUT anterior, que
      // ya esta en la cache: guardarCambio lo toma de ahi.
      guardarCambio(id, resultado.previo).then(function (r) {
        if (r) mostrarAviso('Cambio deshecho.');
      });
    });
  }

  function alternarHecha(id) {
    const t = obtener(id);
    if (!t) return;
    const hecha = esFinal(t.status);
    const nuevo = hecha ? ESTADO_INICIAL : ESTADO_HECHO;
    guardarCambio(id, { status: nuevo }).then(function (r) {
      ofrecerDeshacer(r, hecha ? `«${tituloCorto(t)}» reabierta` : `«${tituloCorto(t)}» completada`);
    });
  }

  function moverAManana(id) {
    const t = obtener(id);
    if (!t) return;
    guardarCambio(id, { due_date: sumarDias(HOY, 1) }).then(function (r) {
      ofrecerDeshacer(r, `«${tituloCorto(t)}» pasa a mañana`);
    });
  }

  function repintarTodo() {
    pintarLista();
    if (estado.seleccion) pintarDetalle();
  }

  /* ═══ Aviso con Deshacer ═══ */

  const aviso = document.getElementById('tasksUndoToast');
  const avisoTexto = document.getElementById('tasksUndoToastText');
  const avisoAccion = document.getElementById('tasksUndoToastAction');
  const avisoCerrar = document.getElementById('tasksUndoToastClose');
  let avisoTemporizador = null;
  let avisoDeshacer = null;

  function ocultarAviso() {
    if (!aviso) return;
    clearTimeout(avisoTemporizador);
    aviso.classList.remove('is-visible');
    aviso.hidden = true;
    avisoDeshacer = null;
  }

  function programarOcultar() {
    clearTimeout(avisoTemporizador);
    avisoTemporizador = setTimeout(ocultarAviso, DURACION_AVISO);
  }

  function mostrarAviso(mensaje, deshacer) {
    if (!aviso) {
      notify('success', mensaje);
      return;
    }
    avisoTexto.textContent = mensaje;
    avisoDeshacer = typeof deshacer === 'function' ? deshacer : null;
    avisoAccion.hidden = !avisoDeshacer;
    aviso.hidden = false;
    // Un fotograma de margen para que la transicion arranque desde fuera.
    requestAnimationFrame(function () { aviso.classList.add('is-visible'); });
    programarOcultar();
  }

  if (aviso) {
    avisoAccion.addEventListener('click', function () {
      const fn = avisoDeshacer;
      ocultarAviso();
      if (fn) fn();
    });
    avisoCerrar.addEventListener('click', ocultarAviso);
    // Mientras se lee o se va a pulsar, no desaparece.
    aviso.addEventListener('mouseenter', function () { clearTimeout(avisoTemporizador); });
    aviso.addEventListener('mouseleave', programarOcultar);
    aviso.addEventListener('focusin', function () { clearTimeout(avisoTemporizador); });
    aviso.addEventListener('focusout', programarOcultar);
  }

  /* ═══ Panel de detalle ═══ */

  const contenido = document.getElementById('tasksDetailContent');
  const cortina = document.getElementById('tasksDetailOverlay');
  const pie = document.getElementById('tasksDetailFooter');
  const campoComentario = document.getElementById('tasksDetailComment');
  const btnEnviarComentario = document.getElementById('tasksDetailCommentSend');
  const btnHecha = document.getElementById('tasksDetailDone');
  const contenedorLista = lista.closest('.bandeja-lista');

  function segmentos(valores, actual, accion, etiqueta, deshabilitado) {
    return `<div class="bandeja-segmentos" role="group" aria-label="${escapeHtml(etiqueta)}">`
      + valores.map(function (v) {
        return `<button type="button" class="bandeja-segmento" data-accion="${accion}" data-valor="${escapeHtml(v)}"`
          + ` data-foco="${accion}:${escapeHtml(v)}" aria-pressed="${v === actual}"${deshabilitado ? ' disabled' : ''}>`
          + `${escapeHtml(v)}</button>`;
      }).join('')
      + '</div>';
  }

  function fechaComentario(valor) {
    const texto = String(valor || '');
    const partes = texto.split(' ');
    if (partes.length === 2 && partes[0] === HOY) return 'hoy ' + partes[1];
    if (partes.length === 2 && partes[0] === sumarDias(HOY, -1)) return 'ayer ' + partes[1];
    return texto;
  }

  function pintarDetalle() {
    const t = estado.detalle && Number(estado.detalle.id) === estado.seleccion
      ? estado.detalle
      : obtener(estado.seleccion);
    if (!t) return;

    const foco = capturarFoco(contenido);
    const entradaChecklist = document.getElementById('tasksDetailChecklistInput');
    const borrador = entradaChecklist ? entradaChecklist.value : '';

    const id = Number(t.id);
    const hecha = esFinal(t.status);
    const vencida = esVencida(t);
    // Sin el detalle completo aun no se sabe si se puede editar: se deja
    // pulsar y, si no, el servidor responde 403 y se revierte.
    const puedeEditar = t.can_edit !== false;
    const puedeObservar = t.can_watch !== false && !!estado.detalle;
    const observando = !!(t.is_watcher || t.is_watching);

    const items = estado.checklist;
    const hechos = items.filter(function (it) { return it.is_completed; }).length;
    const porcentaje = items.length ? Math.round((hechos / items.length) * 100) : 0;

    const checklistHtml = estado.cargandoDetalle && !items.length
      ? '<p class="bandeja-detalle-nota">Cargando…</p>'
      : (items.length
        ? '<ul class="bandeja-checklist">' + items.map(function (it) {
          const itemId = Number(it.id);
          return `<li class="${it.is_completed ? 'is-completed' : ''}"><label>`
            + `<input type="checkbox" data-accion="check" data-item="${itemId}" data-foco="check:${itemId}"${it.is_completed ? ' checked' : ''}${puedeEditar ? '' : ' disabled'}>`
            + `<span>${escapeHtml(it.body || '')}</span></label></li>`;
        }).join('') + '</ul>'
        : '<p class="bandeja-detalle-nota">Sin elementos. Divide la tarea en pasos para ver el avance sin cambiar el estado.</p>');

    const comentariosHtml = estado.cargandoDetalle && !estado.comentarios.length
      ? '<p class="bandeja-detalle-nota">Cargando…</p>'
      : (estado.comentarios.length
        ? '<ul class="bandeja-comentarios">' + estado.comentarios.map(function (c) {
          return '<li>'
            + `<p class="bandeja-comentario-meta"><strong>${escapeHtml(c.user_name || 'Usuario')}</strong> · ${escapeHtml(fechaComentario(c.created_at))}</p>`
            + `<p class="bandeja-comentario-texto">${escapeHtml(c.body || '')}</p>`
            + '</li>';
        }).join('') + '</ul>'
        : '<p class="bandeja-detalle-nota">Sin comentarios todavía.</p>');

    contenido.innerHTML = ''
      + '<div class="bandeja-detalle-cabecera">'
      +   `<p class="bandeja-detalle-ref">TAR-${id}${t.creator_name ? ' · Creada por ' + escapeHtml(t.creator_name) : ''}</p>`
      +   '<div class="bandeja-detalle-botones">'
      +     (puedeObservar
              ? `<button type="button" class="btn btn-secondary btn-sm bandeja-observar" data-accion="observar" data-foco="observar" aria-pressed="${observando}">`
                + `<i class="${observando ? 'fa-solid' : 'fa-regular'} fa-eye" aria-hidden="true"></i> ${observando ? 'Observando' : 'Observar'}</button>`
              : '')
      +     '<button type="button" class="btn btn-secondary btn-sm" data-accion="mas" data-foco="mas">Más detalles</button>'
      +     '<button type="button" class="bandeja-icono-btn" data-accion="cerrar" data-foco="cerrar" aria-label="Cerrar detalle">&times;</button>'
      +   '</div>'
      + '</div>'
      + `<h2 class="bandeja-detalle-titulo" id="tasksDetailTitle" tabindex="-1">${escapeHtml(t.title || '(sin título)')}</h2>`
      + segmentos(ESTADOS, t.status, 'estado', 'Estado', !puedeEditar)
      + '<dl class="bandeja-datos">'
      +   `<dt>Asignado</dt><dd>${escapeHtml(t.assignee_name || '—')}</dd>`
      +   `<dt>Entrega</dt><dd class="${vencida ? 'is-overdue' : ''}">${escapeHtml(t.due_date ? fechaLarga(t.due_date) + ' · ' + etiquetaVencimiento(t.due_date) : '—')}</dd>`
      +   `<dt>Prioridad</dt><dd>${segmentos(PRIORIDADES, t.priority, 'prioridad', 'Prioridad', !puedeEditar)}</dd>`
      +   `<dt>Cliente</dt><dd>${escapeHtml(t.client || '—')}</dd>`
      + '</dl>'
      + '<section class="bandeja-detalle-seccion" aria-labelledby="tasksDetailChecklistTitle">'
      +   `<h3 id="tasksDetailChecklistTitle">Checklist <span>${hechos}/${items.length}</span></h3>`
      +   (items.length
            ? `<div class="bandeja-progreso" role="progressbar" aria-label="Avance del checklist" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${porcentaje}">`
              + `<span style="width:${porcentaje}%"></span></div>`
            : '')
      +   checklistHtml
      +   (puedeEditar
            ? '<form class="bandeja-checklist-alta" data-form="checklist" autocomplete="off">'
              + '<label for="tasksDetailChecklistInput" class="visually-hidden">Añadir elemento al checklist</label>'
              + '<input type="text" class="form-input" id="tasksDetailChecklistInput" maxlength="500" placeholder="Añadir elemento">'
              + '<button type="submit" class="btn btn-secondary btn-sm" data-foco="checklist-add">Añadir</button>'
              + '</form>'
            : '')
      + '</section>'
      + '<section class="bandeja-detalle-seccion" aria-labelledby="tasksDetailCommentsTitle">'
      +   `<h3 id="tasksDetailCommentsTitle">Comentarios <span>${estado.comentarios.length || Number(t.comments_count) || 0}</span></h3>`
      +   comentariosHtml
      + '</section>';

    const nuevaEntrada = document.getElementById('tasksDetailChecklistInput');
    if (nuevaEntrada && borrador) nuevaEntrada.value = borrador;
    restaurarFoco(contenido, foco);

    panel.dataset.estado = 'tarea';
    // Quien solo observa una tarea de otra unidad puede verla pero no
    // comentar (el servidor responde 403): no se le ofrece el campo.
    if (pie) {
      pie.classList.toggle('is-solo-lectura', !puedeEditar);
      campoComentario.disabled = !puedeEditar;
      btnEnviarComentario.disabled = !puedeEditar;
    }
    if (btnHecha) {
      btnHecha.textContent = hecha ? 'Reabrir' : 'Hecha';
      btnHecha.disabled = !puedeEditar;
    }
  }

  function cargarDetalle(id, opciones) {
    const opts = opciones || {};
    id = Number(id);
    const turno = ++estado.turnoDetalle;
    // Abrir otra fila cancela lo que se estaba pidiendo de la anterior: cada
    // clic eran tres peticiones y el limite por usuario es por hora.
    if (estado.abortarDetalle) estado.abortarDetalle.abort();
    const control = typeof AbortController === 'function' ? new AbortController() : null;
    estado.abortarDetalle = control;
    const conSenal = control ? { signal: control.signal } : {};
    const vacio = Promise.resolve({ success: true, items: [], comments: [] });
    if (!opts.silencioso) {
      estado.cargandoDetalle = true;
      estado.checklist = [];
      estado.comentarios = [];
    }
    // Una tarea recien creada no tiene checklist ni comentarios: basta el
    // detalle.
    return Promise.all([
      requestJson(`/api/tasks/${id}`, conSenal),
      opts.recienCreada ? vacio : requestJson(`/api/tasks/${id}/checklist`, conSenal).catch(function () { return {}; }),
      opts.recienCreada ? vacio : requestJson(`/api/tasks/${id}/comments`, conSenal).catch(function () { return {}; })
    ]).then(function (r) {
      if (turno !== estado.turnoDetalle || estado.seleccion !== id) return;
      estado.cargandoDetalle = false;
      const det = r[0];
      if (!det || !det.success || !det.task) {
        notify('error', (det && det.error) || 'No se pudo abrir la tarea.');
        cerrarDetalle();
        return;
      }
      estado.detalle = det.task;
      estado.checklist = (r[1] && r[1].success && Array.isArray(r[1].items)) ? r[1].items : [];
      estado.comentarios = (r[2] && r[2].success && Array.isArray(r[2].comments)) ? r[2].comments : [];
      // La fila toma los contadores frescos del detalle.
      fusionar(id, {
        title: det.task.title,
        status: det.task.status,
        priority: det.task.priority,
        due_date: det.task.due_date,
        updated_at: det.task.updated_at,
        checklist_total: det.task.checklist_total,
        checklist_done: det.task.checklist_done,
        comments_count: det.task.comments_count,
        is_watching: det.task.is_watching
      });
      repintarTodo();
    }).catch(function () {
      // Abortada por otra seleccion: no es un error que contar.
      if (turno !== estado.turnoDetalle) return;
      estado.cargandoDetalle = false;
      notify('error', 'Error de conexión al abrir la tarea.');
    });
  }

  // `semilla` sirve cuando la tarea no esta en la lista (p. ej. recien creada
  // para otra persona): se pinta con eso mientras llega el detalle.
  function seleccionar(id, semilla, recienCreada) {
    id = Number(id);
    descartarPista();
    estado.seleccion = id;
    estado.detalle = null;
    if (!obtener(id) && semilla) estado.detalle = semilla;
    estado.focoAlCerrar = id;
    estado.cargandoDetalle = true;
    estado.checklist = [];
    estado.comentarios = [];
    if (campoComentario) campoComentario.value = '';
    // Se pinta ya con lo que trae la fila; el resto llega con el detalle.
    pintarLista();
    pintarDetalle();
    abrirHojaDetalle();
    // En movil el foco entra en la hoja; en escritorio se queda en la fila
    // (pintarLista ya lo devolvio a su boton) para seguir recorriendo la lista.
    if (movil.matches) {
      const titulo = document.getElementById('tasksDetailTitle');
      if (titulo) titulo.focus({ preventScroll: true });
    } else if (contenedorLista && panel.getBoundingClientRect().top >= contenedorLista.getBoundingClientRect().bottom) {
      // Sin sitio al lado, el panel quedo debajo de la lista: se acerca.
      const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      panel.scrollIntoView({ block: 'nearest', behavior: reducir ? 'auto' : 'smooth' });
    }
    cargarDetalle(id, { recienCreada: !!recienCreada });
  }

  function cerrarDetalle() {
    const volverA = estado.focoAlCerrar;
    estado.seleccion = null;
    estado.detalle = null;
    estado.turnoDetalle++;
    if (estado.abortarDetalle) estado.abortarDetalle.abort();
    estado.abortarDetalle = null;
    panel.dataset.estado = 'vacio';
    contenido.innerHTML = '';
    cerrarHojaDetalle();
    pintarLista();
    if (volverA != null) {
      const boton = lista.querySelector(`[data-tarea="${volverA}"] [data-accion="abrir"]`);
      if (boton) boton.focus({ preventScroll: true });
    }
  }

  // ─── Hoja inferior (movil) ───
  // En escritorio el panel es parte de la pagina; en movil es un dialogo y se
  // comporta como tal: cortina, foco dentro y Escape para salir.
  function abrirHojaDetalle() {
    if (!movil.matches) return;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'tasksDetailTitle');
    panel.classList.add('is-abierta');
    cortina.classList.add('is-visible');
    document.documentElement.classList.add('bandeja-sin-scroll');
  }

  function cerrarHojaDetalle() {
    panel.classList.remove('is-abierta');
    panel.style.transform = '';
    cortina.classList.remove('is-visible');
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    panel.removeAttribute('aria-labelledby');
    if (!hojaNuevaAbierta()) document.documentElement.classList.remove('bandeja-sin-scroll');
  }

  function sincronizarModo() {
    if (movil.matches) {
      if (estado.seleccion) abrirHojaDetalle();
    } else {
      cerrarHojaDetalle();
      panel.style.transform = '';
    }
    actualizarPista();
  }
  if (movil.addEventListener) movil.addEventListener('change', sincronizarModo);

  cortina.addEventListener('click', cerrarDetalle);

  // Atrapar el foco "a medias": Tab y Mayus+Tab dan la vuelta dentro de la
  // hoja. No hace falta mas mientras la cortina tape el resto.
  function atraparFoco(evento, contenedor) {
    if (evento.key !== 'Tab') return;
    const enfocables = Array.from(contenedor.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [tabindex="0"], a[href]'
    )).filter(function (el) { return el.offsetParent !== null; });
    if (!enfocables.length) return;
    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    if (evento.shiftKey && document.activeElement === primero) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  }

  panel.addEventListener('keydown', function (evento) {
    if (movil.matches && panel.classList.contains('is-abierta')) atraparFoco(evento, panel);
  });

  // Arrastrar el asa hacia abajo cierra la hoja, como en cualquier hoja
  // nativa. Se decide por distancia o por velocidad: un tiron corto y rapido
  // tambien cierra.
  function arrastrarParaCerrar(asa, hoja, alCerrar) {
    let inicio = null;
    asa.addEventListener('pointerdown', function (e) {
      if (!movil.matches) return;
      inicio = { y: e.clientY, t: performance.now(), dy: 0 };
      asa.setPointerCapture(e.pointerId);
      hoja.classList.add('is-arrastrando');
    });
    asa.addEventListener('pointermove', function (e) {
      if (!inicio) return;
      inicio.dy = Math.max(0, e.clientY - inicio.y);
      hoja.style.transform = `translateY(${inicio.dy}px)`;
    });
    function soltar() {
      if (!inicio) return;
      const velocidad = inicio.dy / Math.max(1, performance.now() - inicio.t);
      const cerrar = inicio.dy > 90 || velocidad > 0.6;
      hoja.classList.remove('is-arrastrando');
      hoja.style.transform = '';
      inicio = null;
      if (cerrar) alCerrar();
    }
    asa.addEventListener('pointerup', soltar);
    asa.addEventListener('pointercancel', soltar);
  }

  const asaDetalle = panel.querySelector('.bandeja-detalle-asa');
  if (asaDetalle) arrastrarParaCerrar(asaDetalle, panel, cerrarDetalle);

  // ─── Acciones dentro del panel ───
  contenido.addEventListener('click', function (evento) {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton || !estado.seleccion) return;
    const id = estado.seleccion;
    const t = obtener(id);
    const accion = boton.dataset.accion;

    if (accion === 'cerrar') { cerrarDetalle(); return; }

    if (accion === 'mas') {
      // El modal completo: encargo, fechas, observadores, actividad, borrar.
      // Queda por encima de la hoja; al guardar, tasks.js llama a
      // recargarVistaHoy y el panel se refresca con lo nuevo.
      if (estado.detalle) app.openModal(true, estado.detalle);
      return;
    }

    if (accion === 'estado' && t) {
      const valor = boton.dataset.valor;
      if (valor === t.status) return;
      guardarCambio(id, { status: valor }).then(function (r) {
        ofrecerDeshacer(r, `«${tituloCorto(t)}» pasa a ${valor}`);
      });
      return;
    }

    if (accion === 'prioridad' && t) {
      const valor = boton.dataset.valor;
      if (valor === t.priority) return;
      guardarCambio(id, { priority: valor }).then(function (r) {
        ofrecerDeshacer(r, `Prioridad de «${tituloCorto(t)}»: ${valor}`);
      });
      return;
    }

    if (accion === 'observar') alternarObservar(id, boton);
  });

  contenido.addEventListener('change', function (evento) {
    const casilla = evento.target.closest('input[data-accion="check"]');
    if (!casilla || !estado.seleccion) return;
    const id = estado.seleccion;
    const itemId = Number(casilla.dataset.item);
    const marcado = casilla.checked;
    const item = estado.checklist.find(function (it) { return Number(it.id) === itemId; });
    if (!item) return;

    const aplicar = function (valor) {
      item.is_completed = valor;
      const hechos = estado.checklist.filter(function (it) { return it.is_completed; }).length;
      fusionar(id, { checklist_done: hechos, checklist_total: estado.checklist.length });
      repintarTodo();
    };
    aplicar(marcado);

    requestJson(`/api/tasks/${id}/checklist/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_completed: marcado })
    }).then(function (data) {
      if (!data || !data.success) {
        aplicar(!marcado);
        notify('error', (data && data.error) || 'No se pudo actualizar el elemento.');
      }
    }).catch(function () {
      aplicar(!marcado);
      notify('error', 'Error de conexión.');
    });
  });

  contenido.addEventListener('submit', function (evento) {
    const form = evento.target.closest('form[data-form="checklist"]');
    if (!form) return;
    evento.preventDefault();
    const entrada = form.querySelector('input');
    const texto = (entrada.value || '').trim();
    const id = estado.seleccion;
    if (!texto || !id) return;
    const boton = form.querySelector('button');
    boton.disabled = true;
    requestJson(`/api/tasks/${id}/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: texto })
    }).then(function (data) {
      if (!data || !data.success || !data.item) {
        notify('error', (data && data.error) || 'No se pudo añadir el elemento.');
        return;
      }
      if (estado.seleccion !== id) return;
      estado.checklist.push(data.item);
      const hechos = estado.checklist.filter(function (it) { return it.is_completed; }).length;
      fusionar(id, { checklist_done: hechos, checklist_total: estado.checklist.length });
      const actual = document.getElementById('tasksDetailChecklistInput');
      if (actual) actual.value = '';
      repintarTodo();
      const otra = document.getElementById('tasksDetailChecklistInput');
      if (otra) otra.focus({ preventScroll: true });
    }).catch(function () {
      notify('error', 'Error de conexión.');
    }).finally(function () {
      const b = contenido.querySelector('form[data-form="checklist"] button');
      if (b) b.disabled = false;
    });
  });

  function alternarObservar(id, boton) {
    const t = obtener(id);
    const yo = (estado.detalle && estado.detalle.current_user_id) || MI_ID;
    if (!t || !yo) return;
    const observando = !!(t.is_watcher || t.is_watching);
    boton.disabled = true;

    const peticion = observando
      ? requestJson(`/api/tasks/${id}/watchers/${yo}`, { method: 'DELETE' })
      : requestJson(`/api/tasks/${id}/watchers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: yo })
        });

    peticion.then(function (data) {
      if (data && data.success) {
        // Dejar de observar una tarea que solo se veia por eso quita el
        // acceso: recargar el detalle daria un 403.
        if (observando && data.can_still_view === false) {
          estado.tareas.delete(id);
          estado.completadasSesion.delete(id);
          cerrarDetalle();
          notify('success', 'Ya no observas esta tarea, y deja de estar a tu vista.');
          app.loadWatchingTasks();
          return;
        }
        fusionar(id, { is_watcher: !observando, is_watching: !observando });
        repintarTodo();
        mostrarAviso(observando ? 'Ya no observas esta tarea.' : 'Ahora observas esta tarea.');
        return;
      }
      // Un segundo "dejar de observar" responde 404: el estado real ya es el
      // que se pedia. Se relee el detalle en vez de mostrar un error.
      cargarDetalle(id, { silencioso: true });
      if (!observando) notify('error', (data && data.error) || 'No se pudo cambiar la observación.');
    }).catch(function () {
      notify('error', 'Error de conexión al cambiar la observación.');
    }).finally(function () {
      const b = contenido.querySelector('[data-accion="observar"]');
      if (b) b.disabled = false;
    });
  }

  // ─── Pie: comentario y Hecha ───
  if (pie) {
    pie.addEventListener('submit', function (evento) {
      evento.preventDefault();
      const id = estado.seleccion;
      const texto = (campoComentario.value || '').trim();
      if (!id || !texto) return;
      btnEnviarComentario.disabled = true;
      requestJson(`/api/tasks/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: texto })
      }).then(function (data) {
        if (!data || !data.success) {
          notify('error', (data && data.error) || 'No se pudo guardar el comentario.');
          return null;
        }
        campoComentario.value = '';
        return requestJson(`/api/tasks/${id}/comments`).then(function (lista2) {
          if (estado.seleccion !== id) return;
          if (lista2 && lista2.success && Array.isArray(lista2.comments)) estado.comentarios = lista2.comments;
          fusionar(id, { comments_count: estado.comentarios.length });
          repintarTodo();
        });
      }).catch(function () {
        notify('error', 'Error de conexión al comentar.');
      }).finally(function () {
        const t = obtener(id);
        btnEnviarComentario.disabled = !!(t && t.can_edit === false);
      });
    });
  }

  if (btnHecha) {
    btnHecha.addEventListener('click', function () {
      if (estado.seleccion) alternarHecha(estado.seleccion);
    });
  }

  /* ═══ Clics en la lista ═══ */

  let suprimirClic = false;

  lista.addEventListener('click', function (evento) {
    if (suprimirClic) {
      // El clic que sigue a un deslizamiento no es una seleccion.
      suprimirClic = false;
      evento.preventDefault();
      return;
    }

    const plegar = evento.target.closest('[data-plegar]');
    if (plegar) {
      const clave = plegar.dataset.plegar;
      if (estado.plegados.has(clave)) estado.plegados.delete(clave);
      else estado.plegados.add(clave);
      pintarLista();
      return;
    }

    const boton = evento.target.closest('button[data-accion]');
    const filaEl = evento.target.closest('[data-tarea]');
    if (!boton || !filaEl) return;
    const id = Number(filaEl.dataset.tarea);
    const accion = boton.dataset.accion;

    if (accion === 'completar') { alternarHecha(id); return; }
    if (accion === 'abrir') {
      if (filaAbierta) { cerrarFilaDeslizada(); return; }
      if (estado.seleccion === id && !movil.matches) return;
      seleccionar(id);
      return;
    }
    if (accion === 'manana') { cerrarFilaDeslizada(); moverAManana(id); return; }
    if (accion === 'hecha') { cerrarFilaDeslizada(); alternarHecha(id); }
  });

  /* ═══ Deslizar para acciones (movil) ═══
     Con eventos de puntero y touch-action: pan-y en la fila: el navegador
     sigue desplazando en vertical y solo los gestos horizontales llegan aqui.
     Se decide la direccion en los primeros pixeles para no robar un scroll. */

  const UMBRAL_DESLIZAR = 30;
  let gesto = null;
  let filaAbierta = null;

  function anchoAcciones(filaEl) {
    const acciones = filaEl.querySelector('.bandeja-fila-acciones');
    return acciones ? acciones.offsetWidth : 0;
  }

  function fijarFilaAbierta(filaEl, abierta) {
    const frente = filaEl.querySelector('.bandeja-fila-frente');
    const acciones = filaEl.querySelector('.bandeja-fila-acciones');
    filaEl.classList.toggle('is-deslizada', abierta);
    frente.style.transform = abierta ? `translateX(${-anchoAcciones(filaEl)}px)` : '';
    if (acciones) {
      acciones.setAttribute('aria-hidden', String(!abierta));
      acciones.querySelectorAll('button').forEach(function (b) { b.tabIndex = abierta ? 0 : -1; });
    }
    filaAbierta = abierta ? filaEl : (filaAbierta === filaEl ? null : filaAbierta);
  }

  function cerrarFilaDeslizada() {
    if (filaAbierta && document.body.contains(filaAbierta)) fijarFilaAbierta(filaAbierta, false);
    filaAbierta = null;
  }

  lista.addEventListener('pointerdown', function (e) {
    if (!movil.matches || e.pointerType === 'mouse') return;
    const frente = e.target.closest('.bandeja-fila-frente');
    if (!frente) return;
    const filaEl = frente.closest('.bandeja-fila');
    if (filaAbierta && filaAbierta !== filaEl) cerrarFilaDeslizada();
    gesto = {
      fila: filaEl,
      frente: frente,
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      dx: 0,
      base: filaEl.classList.contains('is-deslizada') ? -anchoAcciones(filaEl) : 0,
      decidido: false,
      horizontal: false
    };
  });

  lista.addEventListener('pointermove', function (e) {
    if (!gesto || e.pointerId !== gesto.id) return;
    const dx = e.clientX - gesto.x0;
    const dy = e.clientY - gesto.y0;
    if (!gesto.decidido) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      gesto.decidido = true;
      gesto.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!gesto.horizontal) { gesto = null; return; }
      try { gesto.frente.setPointerCapture(e.pointerId); } catch (err) { /* puntero ya liberado */ }
      gesto.fila.classList.add('is-arrastrando');
    }
    gesto.dx = dx;
    const ancho = anchoAcciones(gesto.fila);
    const pos = Math.min(0, Math.max(-ancho, gesto.base + dx));
    gesto.frente.style.transform = `translateX(${pos}px)`;
  });

  function terminarGesto() {
    if (!gesto) return;
    const g = gesto;
    gesto = null;
    if (!g.horizontal) return;
    g.fila.classList.remove('is-arrastrando');
    suprimirClic = true;
    // Si no llega a haber clic (el dedo salio de la fila), no se queda armado.
    setTimeout(function () { suprimirClic = false; }, 400);
    const abrir = g.base === 0 ? g.dx < -UMBRAL_DESLIZAR : g.dx < UMBRAL_DESLIZAR;
    fijarFilaAbierta(g.fila, abrir);
    if (abrir) descartarPista();
  }
  lista.addEventListener('pointerup', terminarGesto);
  lista.addEventListener('pointercancel', terminarGesto);

  // Tocar fuera de la fila abierta la cierra.
  document.addEventListener('pointerdown', function (e) {
    if (filaAbierta && !filaAbierta.contains(e.target)) cerrarFilaDeslizada();
  });

  /* ═══ Pista de primer uso (movil) ═══ */
  const pista = document.getElementById('tasksSwipeHint');
  const pistaCerrar = document.getElementById('tasksSwipeHintClose');

  function actualizarPista() {
    if (!pista) return;
    pista.classList.toggle('modal-hidden', !movil.matches || leerPreferencia(CLAVE_PISTA) === '1');
  }
  function descartarPista() {
    if (!pista || pista.classList.contains('modal-hidden')) return;
    guardarPreferencia(CLAVE_PISTA, '1');
    actualizarPista();
  }
  if (pistaCerrar) pistaCerrar.addEventListener('click', descartarPista);

  /* ═══ Alcance ═══ */
  const chips = document.querySelectorAll('.bandeja-chip[data-scope]');
  function pintarAlcance() {
    chips.forEach(function (c) {
      c.setAttribute('aria-pressed', String(c.dataset.scope === estado.alcance));
    });
  }
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      if (c.dataset.scope === estado.alcance) return;
      estado.alcance = c.dataset.scope;
      guardarPreferencia(CLAVE_ALCANCE, estado.alcance);
      pintarAlcance();
      // Lo completado en la visita pertenecia al alcance anterior.
      estado.completadasSesion.clear();
      cargarLista({ sinDetalle: true });
    });
  });

  /* ═══ Alta rapida ═══
     Una linea de texto con tres atajos opcionales:
       @persona  asigna (por defecto, a quien escribe)
       hoy, mañana, pasado mañana, lunes…domingo  fija la entrega (por defecto, hoy)
       !alta     fija la prioridad (por defecto, la de la unidad)
     Lo que no se reconoce se queda en el titulo: mejor un titulo con una
     palabra de mas que una tarea con una fecha que nadie pidio. */

  const formAlta = document.getElementById('tasksQuickAdd');
  const entradaAlta = document.getElementById('tasksQuickAddInput');
  const vistaPrevia = document.getElementById('tasksQuickAddPreview');
  const textoPrevioDefecto = vistaPrevia ? vistaPrevia.innerHTML : '';

  // Nombres largos primero: "ana maria" debe ganar a "ana".
  const personasOrdenadas = PERSONAS.slice().sort(function (a, b) {
    return String(b.username || '').length - String(a.username || '').length;
  });

  function interpretar(texto) {
    const fichas = String(texto || '').trim().split(/\s+/).filter(Boolean);
    const resultado = {
      titulo: '',
      asignado: MI_ID,
      fecha: HOY,
      fechaExplicita: false,
      prioridad: PRIORIDAD_DEFECTO,
      problema: ''
    };
    const resto = [];
    let fechaPuesta = false;

    // Las palabras de fecha solo cuentan al final ("Preparar la mañana de
    // cine" no es una tarea para mañana). Se busca desde atras donde empieza
    // la cola de atajos: fechas, @persona (tambien de varias palabras) y !prio.
    let inicioCola = fichas.length;
    for (let j = fichas.length - 1; j >= 0;) {
      const n = normalizar(fichas[j]);
      let paso = 0;
      for (const p of personasOrdenadas) {
        const partes = normalizar(p.username).split(/\s+/);
        const desde = j - partes.length + 1;
        if (partes.length > 1 && desde >= 0 && fichas[desde][0] === '@'
            && [normalizar(fichas[desde]).slice(1)].concat(fichas.slice(desde + 1, j + 1).map(normalizar)).join(' ') === partes.join(' ')) {
          paso = partes.length;
          break;
        }
      }
      if (!paso && fichas[j].length > 1 && (fichas[j][0] === '@' || fichas[j][0] === '!')) paso = 1;
      if (!paso && n === 'manana' && j > 0 && normalizar(fichas[j - 1]) === 'pasado') paso = 2;
      if (!paso && (n === 'hoy' || n === 'manana' || DIAS_SEMANA.indexOf(n) !== -1)) paso = 1;
      if (!paso) break;
      j -= paso;
      inicioCola = j + 1;
    }

    for (let i = 0; i < fichas.length; i++) {
      const ficha = fichas[i];
      const norm = normalizar(ficha);

      if (ficha.length > 1 && ficha[0] === '@') {
        let encontrada = null;
        let consumidas = 1;
        for (const p of personasOrdenadas) {
          const partes = normalizar(p.username).split(/\s+/);
          const tramo = [norm.slice(1)].concat(fichas.slice(i + 1, i + partes.length).map(normalizar)).join(' ');
          if (tramo === partes.join(' ')) {
            encontrada = p;
            consumidas = partes.length;
            break;
          }
        }
        if (!encontrada) {
          const prefijo = norm.slice(1);
          const candidatas = PERSONAS.filter(function (p) { return normalizar(p.username).startsWith(prefijo); });
          if (candidatas.length === 1) encontrada = candidatas[0];
          else if (candidatas.length > 1) resultado.problema = `«${ficha}» coincide con varias personas; escribe más letras.`;
          else resultado.problema = `No hay nadie llamado «${ficha.slice(1)}» en tu unidad.`;
        }
        if (encontrada) {
          resultado.asignado = Number(encontrada.id);
          i += consumidas - 1;
          continue;
        }
        resto.push(ficha);
        continue;
      }

      if (ficha.length > 1 && ficha[0] === '!') {
        const buscada = norm.slice(1);
        let prio = PRIORIDADES.find(function (p) { return normalizar(p) === buscada; });
        if (!prio) {
          const candidatas = PRIORIDADES.filter(function (p) { return normalizar(p).startsWith(buscada); });
          if (candidatas.length === 1) prio = candidatas[0];
        }
        if (prio) { resultado.prioridad = prio; continue; }
        resto.push(ficha);
        continue;
      }

      if (!fechaPuesta && i >= inicioCola) {
        if (norm === 'pasado' && normalizar(fichas[i + 1]) === 'manana') {
          resultado.fecha = sumarDias(HOY, 2);
          fechaPuesta = true;
          i += 1;
          continue;
        }
        if (norm === 'hoy') { resultado.fecha = HOY; fechaPuesta = true; continue; }
        if (norm === 'manana') { resultado.fecha = sumarDias(HOY, 1); fechaPuesta = true; continue; }
        const dia = DIAS_SEMANA.indexOf(norm);
        if (dia !== -1) {
          const hoyFecha = aFecha(HOY);
          // La proxima vez que llegue ese dia; si es hoy mismo, la semana que
          // viene (para hoy ya esta "hoy").
          let faltan = (dia - (hoyFecha ? hoyFecha.getDay() : 0) + 7) % 7;
          if (faltan === 0) faltan = 7;
          resultado.fecha = sumarDias(HOY, faltan);
          fechaPuesta = true;
          continue;
        }
      }
      resto.push(ficha);
    }

    resultado.fechaExplicita = fechaPuesta;
    resultado.titulo = resto.join(' ').trim();
    return resultado;
  }

  function describirFecha(iso) {
    const etiqueta = etiquetaVencimiento(iso);
    return etiqueta === 'hoy' || etiqueta === 'mañana' ? `${etiqueta} (${fechaLarga(iso)})` : fechaLarga(iso);
  }

  function pintarVistaPrevia() {
    if (!vistaPrevia || !entradaAlta) return;
    const texto = entradaAlta.value.trim();
    if (!texto) {
      vistaPrevia.innerHTML = textoPrevioDefecto;
      vistaPrevia.classList.remove('is-error');
      return;
    }
    const r = interpretar(texto);
    vistaPrevia.classList.toggle('is-error', !!r.problema);
    if (r.problema) {
      vistaPrevia.textContent = r.problema;
      return;
    }
    const persona = nombreDePersona(r.asignado) || 'ti';
    vistaPrevia.textContent = r.titulo
      ? `Se creará: «${r.titulo}» · ${persona === 'ti' ? 'para ti' : persona} · ${describirFecha(r.fecha)} · prioridad ${r.prioridad}`
      : 'Falta el título: escribe qué hay que hacer.';
  }

  function crearTarea(datos) {
    const payload = {
      title: datos.titulo,
      client: '',
      directorate: '',
      requested_by: '',
      budget_type: '',
      description: '',
      assignee_id: datos.asignado,
      due_date: datos.fecha,
      priority: datos.prioridad,
      start_date: '',
      end_date: '',
      status: ESTADO_INICIAL,
      expected_updated_at: '',
      is_recurrent: false,
      recurrence_type: '',
      recurrence_end: ''
    };
    return requestJson('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (data) {
      if (!data || !data.success || !Array.isArray(data.tasks) || !data.tasks.length) {
        notify('error', (data && data.error) || 'No se pudo crear la tarea.');
        return null;
      }
      const nueva = data.tasks[0];
      const persona = nombreDePersona(nueva.assignee_id) || nueva.assignee_name || '';
      mostrarAviso(`Tarea creada${persona && persona !== 'ti' ? ' para ' + persona : ''}: «${tituloCorto(nueva)}»`);
      app.refrescarCalendario();
      // Se mete en la cache en vez de recargar la lista: son dos peticiones
      // menos por alta, y quien encadena varias llegaba al limite por hora.
      // Solo si encaja en lo que la bandeja muestra (alcance y fecha).
      const encaja = (estado.alcance !== 'mine' || Number(nueva.assignee_id) === MI_ID)
        && !!nueva.due_date && nueva.due_date <= sumarDias(HOY, 7);
      if (encaja) {
        estado.tareas.set(Number(nueva.id), Object.assign({
          checklist_total: 0, checklist_done: 0, comments_count: 0, is_watching: false
        }, nueva));
        if (grupoDe(nueva) === 'semana') estado.plegados.delete('semana');
        pintarLista();
      }
      // En movil no se abre la hoja de golpe: quien crea desde el telefono
      // suele encadenar varias. En escritorio el panel muestra la nueva.
      if (!movil.matches) seleccionar(nueva.id, nueva, true);
      return nueva;
    }).catch(function () {
      notify('error', 'Error de conexión. La tarea no se creó.');
      return null;
    });
  }

  if (formAlta && entradaAlta) {
    entradaAlta.addEventListener('input', pintarVistaPrevia);
    entradaAlta.addEventListener('blur', function () { formAlta.classList.remove('is-destacada'); });
    formAlta.addEventListener('submit', function (evento) {
      evento.preventDefault();
      const r = interpretar(entradaAlta.value);
      if (r.problema) {
        notify('error', r.problema);
        entradaAlta.focus();
        return;
      }
      if (!r.titulo) {
        notify('error', 'Escribe qué hay que hacer.');
        entradaAlta.focus();
        return;
      }
      const boton = document.getElementById('tasksQuickAddBtn');
      if (boton) boton.disabled = true;
      entradaAlta.disabled = true;
      crearTarea(r).then(function (nueva) {
        if (nueva) {
          entradaAlta.value = '';
          pintarVistaPrevia();
        }
      }).finally(function () {
        if (boton) boton.disabled = false;
        entradaAlta.disabled = false;
        entradaAlta.focus({ preventScroll: true });
      });
    });
  }

  /* ═══ Nueva tarea: hoja movil ═══ */
  const hojaNueva = document.getElementById('tasksNewSheet');
  const formNueva = document.getElementById('tasksNewSheetForm');
  const entradaNueva = document.getElementById('tasksNewSheetInput');
  let focoAntesDeNueva = null;

  function hojaNuevaAbierta() {
    return !!(hojaNueva && !hojaNueva.hidden);
  }

  function marcarSegmento(grupo, boton) {
    grupo.querySelectorAll('.bandeja-segmento').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b === boton));
    });
  }

  function abrirHojaNueva() {
    if (!hojaNueva) return;
    focoAntesDeNueva = document.activeElement;
    hojaNueva.hidden = false;
    document.documentElement.classList.add('bandeja-sin-scroll');
    requestAnimationFrame(function () {
      hojaNueva.classList.add('is-abierta');
      // 16px de letra en el campo: con menos, iOS hace zoom al enfocarlo.
      if (entradaNueva) entradaNueva.focus({ preventScroll: true });
    });
  }

  function cerrarHojaNueva() {
    if (!hojaNuevaAbierta()) return;
    hojaNueva.classList.remove('is-abierta');
    hojaNueva.querySelector('.bandeja-hoja').style.transform = '';
    hojaNueva.hidden = true;
    if (!panel.classList.contains('is-abierta')) document.documentElement.classList.remove('bandeja-sin-scroll');
    if (focoAntesDeNueva && document.body.contains(focoAntesDeNueva)) focoAntesDeNueva.focus({ preventScroll: true });
  }

  if (hojaNueva && formNueva) {
    const botonSemana = formNueva.querySelector('[data-cuando="semana"]');
    if (botonSemana && esFinDeSemana()) botonSemana.textContent = 'Próximo viernes';
    hojaNueva.addEventListener('click', function (evento) {
      if (evento.target.closest('[data-cerrar-nueva]')) { cerrarHojaNueva(); return; }
      const segmento = evento.target.closest('.bandeja-segmento');
      if (segmento) marcarSegmento(segmento.parentElement, segmento);
    });
    formNueva.addEventListener('keydown', function (evento) { atraparFoco(evento, formNueva); });

    const asaNueva = formNueva.querySelector('.bandeja-detalle-asa');
    if (asaNueva) arrastrarParaCerrar(asaNueva, formNueva, cerrarHojaNueva);

    formNueva.addEventListener('submit', function (evento) {
      evento.preventDefault();
      const titulo = (entradaNueva.value || '').trim();
      if (!titulo) {
        notify('error', 'Escribe qué hay que hacer.');
        entradaNueva.focus();
        return;
      }
      const cuando = formNueva.querySelector('[data-cuando][aria-pressed="true"]');
      const prio = formNueva.querySelector('[data-prioridad][aria-pressed="true"]');
      const clave = cuando ? cuando.dataset.cuando : 'hoy';
      const fecha = clave === 'manana' ? sumarDias(HOY, 1) : (clave === 'semana' ? proximoViernes() : HOY);
      const boton = document.getElementById('tasksNewSheetCreate');
      boton.disabled = true;
      crearTarea({
        titulo: titulo,
        asignado: MI_ID,
        fecha: fecha,
        prioridad: prio ? prio.dataset.prioridad : PRIORIDAD_DEFECTO
      }).then(function (nueva) {
        if (!nueva) return;
        entradaNueva.value = '';
        cerrarHojaNueva();
      }).finally(function () {
        boton.disabled = false;
      });
    });
  }

  // Abre la creacion que toca segun el ancho: hoja en movil; en escritorio,
  // el foco en la barra de alta con un realce para que se vea donde escribir.
  function abrirCreacion() {
    if (shell.dataset.vista !== 'hoy' && typeof app.aplicarVista === 'function') app.aplicarVista('hoy');
    if (movil.matches && hojaNueva) {
      abrirHojaNueva();
      return;
    }
    if (formAlta && entradaAlta) {
      formAlta.classList.add('is-destacada');
      entradaAlta.focus();
      formAlta.scrollIntoView({ block: 'nearest' });
    }
  }

  // Contrato con la barra inferior global: su "+" es un enlace a
  // /tasks?nueva=1 marcado con data-nueva-tarea. Estando ya aqui, recargar la
  // pagina para abrir un formulario seria absurdo: se intercepta.
  document.addEventListener('click', function (evento) {
    const enlace = evento.target.closest('[data-nueva-tarea]');
    if (!enlace) return;
    evento.preventDefault();
    abrirCreacion();
  });

  /* ═══ Teclado global ═══ */
  document.addEventListener('keydown', function (evento) {
    if (evento.key !== 'Escape') return;
    // Si el modal completo esta abierto, el Escape es suyo.
    const modal = document.getElementById('taskModalOverlay');
    if (modal && modal.classList.contains('open')) return;
    if (hojaNuevaAbierta()) { cerrarHojaNueva(); return; }
    if (filaAbierta) { cerrarFilaDeslizada(); return; }
    if (!estado.seleccion) return;
    // En escritorio solo si el foco esta en la bandeja: un Escape en el
    // buscador no deberia cerrar el panel.
    if (movil.matches || panel.contains(document.activeElement) || lista.contains(document.activeElement)) {
      cerrarDetalle();
    }
  });

  /* ═══ Arranque ═══ */
  const btnRefrescar = document.getElementById('btnTodayRefresh');
  if (btnRefrescar) btnRefrescar.addEventListener('click', function () { cargarLista(); });

  // Cualquier cambio que refresque el calendario (crear, mover o editar en el
  // modal) refresca tambien la bandeja, o las dos vistas se contradicen.
  window.recargarVistaHoy = function () { return cargarLista(); };

  pintarAlcance();
  actualizarPista();
  cargarLista();

  // ?nueva=1 llega desde la paleta de comandos o desde la barra inferior de
  // otra pagina. Se abre la creacion y se limpia el parametro para que
  // recargar no la vuelva a abrir.
  const params = new URLSearchParams(window.location.search);
  if (params.get('nueva') === '1') {
    params.delete('nueva');
    const resto = params.toString();
    try {
      history.replaceState(history.state, '', window.location.pathname + (resto ? '?' + resto : '') + window.location.hash);
    } catch (e) { /* sin History API, el parametro se queda */ }
    abrirCreacion();
  }
});

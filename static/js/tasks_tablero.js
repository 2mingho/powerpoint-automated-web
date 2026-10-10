/* Tablero Kanban, etiquetas y relaciones entre tareas.

   Va aparte por lo mismo que la bandeja: tasks.js ya pasa de 2900 lineas.
   Reutiliza lo que tasks.js cuelga de window.TareasApp (peticiones, avisos,
   el modal completo y los filtros) en vez de copiarlo.

   - Tablero: una columna por estado. Arrastrar cambia estado y sitio; con el
     teclado, Alt+flecha lleva la tarjeta a la columna de al lado.
   - Etiquetas: se ponen y quitan en el modal y se gestionan en un dialogo.
   - Relaciones: "bloqueada por" y "bloquea a", en una pestana del modal.

   Etiquetas y relaciones se guardan al momento, como el checklist: no
   esperan al boton Guardar del modal. */

document.addEventListener('DOMContentLoaded', function () {
  const shell = document.getElementById('tasksShell');
  const tableroEl = document.getElementById('tasksBoard');
  const app = window.TareasApp;
  if (!shell || !tableroEl || !app) return;

  const requestJson = app.requestJson;
  const escapeHtml = app.escapeHtml;
  const notify = app.notify;
  const HOY = app.HOY || '';
  const FINALES = app.FINAL_STATUSES || [];

  const COLORES = [
    { clave: 'neutro', nombre: 'Gris' },
    { clave: 'info', nombre: 'Azul' },
    { clave: 'aviso', nombre: 'Ocre' },
    { clave: 'alerta', nombre: 'Rojo' },
    { clave: 'bien', nombre: 'Verde' },
    { clave: 'violeta', nombre: 'Violeta' }
  ];
  const CLAVE_ALCANCE = 'nl-tablero-alcance';

  function leerPreferencia(clave) {
    try { return localStorage.getItem(clave); } catch (e) { return null; }
  }
  function guardarPreferencia(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch (e) { /* modo privado */ }
  }

  const estado = {
    columnas: [],
    tareas: [],
    etiquetas: [],
    alcance: leerPreferencia(CLAVE_ALCANCE) || '',
    etiqueta: '',
    turno: 0,
    pendiente: true,
    cerradasDias: 14,
    sortables: []
  };

  /* ─── Utilidades de pintado ─── */

  function esFinal(nombre) { return FINALES.includes(nombre); }
  function esVencida(t) { return !esFinal(t.status) && !!t.due_date && !!HOY && t.due_date < HOY; }

  function claseDePrioridad(prioridad) {
    const p = String(prioridad || '').toLowerCase();
    if (p === 'alta' || p === 'urgente') return 'prio-alta';
    if (p === 'baja') return 'prio-baja';
    return 'prio-media';
  }

  function iniciales(nombre) {
    const partes = String(nombre || '').trim().split(/[\s._-]+/).filter(Boolean);
    if (!partes.length) return '?';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[1][0]).toUpperCase();
  }

  function fechaCorta(iso) {
    if (!iso) return '';
    if (iso === HOY) return 'Hoy';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
  }

  function chipEtiqueta(tag) {
    return `<span class="etiqueta tono-${escapeHtml(tag.color || 'neutro')}">${escapeHtml(tag.nombre)}</span>`;
  }

  // La usan tambien la bandeja y el modal.
  app.htmlEtiquetas = function (tags) {
    return (tags || []).map(chipEtiqueta).join('');
  };

  /* ─── Tablero ─── */

  function tablaVisible() { return shell.dataset.vista === 'tablero'; }

  function parametros() {
    const filtros = typeof app.filtros === 'function' ? app.filtros() : {};
    const p = new URLSearchParams();
    // El estado no filtra: aqui las columnas son los estados.
    ['priority', 'assignee_id', 'client', 'area', 'overdue'].forEach(function (k) {
      if (filtros[k]) p.set(k, filtros[k]);
    });
    if (estado.alcance) p.set('scope', estado.alcance);
    if (estado.etiqueta) p.set('tag_id', estado.etiqueta);
    return p.toString();
  }

  function cargar() {
    const turno = ++estado.turno;
    tableroEl.setAttribute('aria-busy', 'true');
    return requestJson('/api/tasks/board?' + parametros()).then(function (data) {
      if (turno !== estado.turno) return;
      if (!data.success) {
        tableroEl.innerHTML = `<p class="today-empty">${escapeHtml(data.error || 'No se pudo cargar el tablero.')}</p>`;
        return;
      }
      estado.columnas = data.columns || [];
      estado.tareas = data.tasks || [];
      estado.etiquetas = data.tags || [];
      estado.cerradasDias = data.closed_days || 14;
      estado.pendiente = false;
      pintarFiltroEtiquetas();
      pintar();
      const aviso = document.getElementById('tasksBoardNotice');
      if (aviso) {
        aviso.textContent = data.truncated
          ? 'Hay más tareas de las que caben en el tablero. Usa los filtros para acotar.'
          : '';
        aviso.classList.toggle('modal-hidden', !data.truncated);
      }
    }).catch(function () {
      if (turno === estado.turno) {
        tableroEl.innerHTML = '<p class="today-empty">Error de conexión al cargar el tablero.</p>';
      }
    }).finally(function () {
      if (turno === estado.turno) tableroEl.setAttribute('aria-busy', 'false');
    });
  }

  window.recargarTablero = function () {
    if (tablaVisible()) return cargar();
    estado.pendiente = true;
    return Promise.resolve();
  };

  function tarjeta(t) {
    const clases = ['tablero-tarjeta', claseDePrioridad(t.priority)];
    if (esFinal(t.status)) clases.push('is-done');
    if (esVencida(t)) clases.push('is-overdue');
    const bloqueada = Number(t.blocked_by_open) || 0;
    if (bloqueada && !esFinal(t.status)) clases.push('is-blocked');

    const pie = [];
    pie.push(`<span class="tablero-prio">${escapeHtml(t.priority || '')}</span>`);
    if (t.due_date) {
      pie.push(`<span class="tablero-fecha"><i class="fa-regular fa-calendar" aria-hidden="true"></i> ${escapeHtml(fechaCorta(t.due_date))}</span>`);
    }
    if (bloqueada && !esFinal(t.status)) {
      pie.push(`<span class="tablero-bloqueo" title="Espera por ${bloqueada} tarea(s) abierta(s)"><i class="fa-solid fa-lock" aria-hidden="true"></i> ${bloqueada}</span>`);
    }
    const total = Number(t.checklist_total) || 0;
    if (total) {
      pie.push(`<span title="Checklist"><i class="fa-regular fa-square-check" aria-hidden="true"></i> ${Number(t.checklist_done) || 0}/${total}</span>`);
    }
    const comentarios = Number(t.comments_count) || 0;
    if (comentarios) {
      pie.push(`<span title="Comentarios"><i class="fa-regular fa-comment" aria-hidden="true"></i> ${comentarios}</span>`);
    }

    const descripcion = [
      t.priority ? 'Prioridad ' + t.priority : '',
      t.due_date ? 'entrega ' + fechaCorta(t.due_date) + (esVencida(t) ? ', vencida' : '') : '',
      bloqueada && !esFinal(t.status) ? 'bloqueada por ' + bloqueada : '',
      t.assignee_name ? 'asignada a ' + t.assignee_name : ''
    ].filter(Boolean).join(', ');

    return ''
      + `<li class="${clases.join(' ')}" data-tarea="${Number(t.id)}">`
      +   `<button type="button" class="tablero-tarjeta-btn" data-accion="abrir" aria-describedby="tasksBoardHint" aria-label="${escapeHtml(t.title || '(sin título)')}. ${escapeHtml(descripcion)}">`
      +     ((t.tags && t.tags.length) ? `<span class="tablero-tarjeta-etiquetas">${app.htmlEtiquetas(t.tags)}</span>` : '')
      +     `<span class="tablero-tarjeta-titulo">${escapeHtml(t.title || '(sin título)')}</span>`
      +     (t.client ? `<span class="tablero-tarjeta-cliente">${escapeHtml(t.client)}</span>` : '')
      +     '<span class="tablero-tarjeta-pie">'
      +       pie.join('')
      +       (t.assignee_name ? `<span class="bandeja-avatar" title="${escapeHtml(t.assignee_name)}">${escapeHtml(iniciales(t.assignee_name))}</span>` : '')
      +     '</span>'
      +   '</button>'
      + '</li>';
  }

  function pintar() {
    estado.sortables.forEach(function (s) { s.destroy(); });
    estado.sortables = [];

    if (!estado.columnas.length) {
      tableroEl.innerHTML = '<p class="today-empty">No hay estados configurados.</p>';
      return;
    }

    const porEstado = {};
    estado.columnas.forEach(function (c) { porEstado[c.nombre] = []; });
    estado.tareas.forEach(function (t) {
      if (porEstado[t.status]) porEstado[t.status].push(t);
    });

    tableroEl.innerHTML = estado.columnas.map(function (c, indice) {
      const tareas = porEstado[c.nombre];
      const vencidas = tareas.filter(esVencida).length;
      const tituloId = 'tableroCol' + indice;
      return ''
        + `<section class="tablero-columna tono-${escapeHtml(c.color || 'neutro')}" aria-labelledby="${tituloId}">`
        +   '<header class="tablero-columna-cabecera">'
        +     '<span class="tablero-columna-punto" aria-hidden="true"></span>'
        +     `<h3 id="${tituloId}">${escapeHtml(c.nombre)}</h3>`
        +     `<span class="tablero-columna-cuenta">${tareas.length}</span>`
        +     (vencidas ? `<span class="tablero-columna-vencidas" title="Vencidas">${vencidas} venc.</span>` : '')
        +   '</header>'
        +   (c.es_final ? `<p class="tablero-columna-nota">Cerradas en los últimos ${Number(estado.cerradasDias)} días</p>` : '')
        +   `<ul class="tablero-tarjetas" data-estado="${escapeHtml(c.nombre)}" aria-labelledby="${tituloId}">`
        +     tareas.map(tarjeta).join('')
        +   '</ul>'
        + '</section>';
    }).join('')
      + '<p class="visually-hidden" id="tasksBoardHint">Alt más flecha izquierda o derecha mueve la tarjeta a la columna de al lado.</p>';

    if (typeof window.Sortable !== 'function') return;
    tableroEl.querySelectorAll('.tablero-tarjetas').forEach(function (lista) {
      estado.sortables.push(new window.Sortable(lista, {
        group: 'tablero',
        animation: 150,
        // En el movil, el dedo tiene que poder desplazar el tablero y tocar
        // una tarjeta sin arrastrarla: el arrastre pide mantener pulsado.
        delay: 220,
        delayOnTouchOnly: true,
        ghostClass: 'is-fantasma',
        chosenClass: 'is-elegida',
        dragClass: 'is-arrastrando',
        onEnd: alSoltar
      }));
    });
  }

  function tareaPorId(id) {
    return estado.tareas.find(function (t) { return Number(t.id) === Number(id); });
  }

  function idDe(el) { return el && el.dataset ? Number(el.dataset.tarea) || null : null; }

  function alSoltar(evento) {
    if (evento.from === evento.to && evento.oldIndex === evento.newIndex) return;
    const item = evento.item;
    mover(idDe(item), evento.to.dataset.estado, idDe(item.previousElementSibling), idDe(item.nextElementSibling));
  }

  function mover(id, destino, anteriorId, siguienteId) {
    const t = tareaPorId(id);
    if (!t) return Promise.resolve();
    const cambiaEstado = t.status !== destino;

    return requestJson(`/api/tasks/${id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: destino,
        anterior_id: anteriorId,
        siguiente_id: siguienteId,
        expected_updated_at: t.updated_at || ''
      })
    }).then(function (data) {
      if (!data.success) {
        notify(data.task ? 'warning' : 'error', data.error || 'No se pudo mover la tarea.');
        return cargar();
      }
      // El orden visible ya es el bueno: se copia del DOM al estado.
      Object.assign(t, data.task);
      const orden = [];
      tableroEl.querySelectorAll('.tablero-tarjeta').forEach(function (li) { orden.push(idDe(li)); });
      estado.tareas.sort(function (a, b) { return orden.indexOf(Number(a.id)) - orden.indexOf(Number(b.id)); });
      pintar();
      if (data.aviso) notify('warning', data.aviso);
      if (cambiaEstado) {
        // Las otras vistas leen el mismo estado: si no se avisan, se contradicen.
        if (typeof app.refrescarCalendario === 'function') app.refrescarCalendario();
        if (typeof window.recargarVistaHoy === 'function') window.recargarVistaHoy();
        // Cerrar una tarea puede liberar a las que esperaban por ella.
        if (esFinal(destino) || esFinal(data.task.status) || Number(t.blocks_count)) cargar();
      }
    }).catch(function () {
      notify('error', 'Error de conexión. La tarjeta vuelve a su sitio.');
      return cargar();
    });
  }

  /* Abrir con clic y mover con el teclado. */
  tableroEl.addEventListener('click', function (evento) {
    const boton = evento.target.closest('[data-accion="abrir"]');
    if (!boton) return;
    const id = idDe(boton.closest('.tablero-tarjeta'));
    requestJson(`/api/tasks/${id}`).then(function (data) {
      if (data.success && data.task) app.openModal(true, data.task);
      else notify('error', data.error || 'No se pudo abrir la tarea.');
    }).catch(function () { notify('error', 'Error de conexión.'); });
  });

  tableroEl.addEventListener('keydown', function (evento) {
    if (!evento.altKey || (evento.key !== 'ArrowLeft' && evento.key !== 'ArrowRight')) return;
    const li = evento.target.closest('.tablero-tarjeta');
    if (!li) return;
    evento.preventDefault();
    const t = tareaPorId(idDe(li));
    const nombres = estado.columnas.map(function (c) { return c.nombre; });
    const destino = nombres[nombres.indexOf(t.status) + (evento.key === 'ArrowRight' ? 1 : -1)];
    if (!destino) return;
    const lista = tableroEl.querySelector(`.tablero-tarjetas[data-estado="${CSS.escape(destino)}"]`);
    const ultima = lista ? lista.lastElementChild : null;
    mover(t.id, destino, idDe(ultima), null).then(function () {
      const nueva = tableroEl.querySelector(`.tablero-tarjeta[data-tarea="${Number(t.id)}"] .tablero-tarjeta-btn`);
      if (nueva) nueva.focus();
    });
  });

  /* Alcance y etiqueta. */
  const chipsAlcance = document.querySelectorAll('[data-tablero-scope]');
  function pintarAlcance() {
    chipsAlcance.forEach(function (c) {
      c.setAttribute('aria-pressed', String(c.dataset.tableroScope === estado.alcance));
    });
  }
  chipsAlcance.forEach(function (c) {
    c.addEventListener('click', function () {
      estado.alcance = c.dataset.tableroScope;
      guardarPreferencia(CLAVE_ALCANCE, estado.alcance);
      pintarAlcance();
      cargar();
    });
  });
  pintarAlcance();

  const selectorEtiqueta = document.getElementById('tasksBoardTag');
  function pintarFiltroEtiquetas() {
    if (!selectorEtiqueta) return;
    const actual = estado.etiqueta;
    selectorEtiqueta.innerHTML = '<option value="">Etiqueta</option>' + estado.etiquetas.map(function (e) {
      return `<option value="${Number(e.id)}">${escapeHtml(e.nombre)}</option>`;
    }).join('');
    selectorEtiqueta.value = estado.etiquetas.some(function (e) { return String(e.id) === actual; }) ? actual : '';
    estado.etiqueta = selectorEtiqueta.value;
  }
  if (selectorEtiqueta) {
    selectorEtiqueta.addEventListener('change', function () {
      estado.etiqueta = selectorEtiqueta.value;
      cargar();
    });
  }

  const btnRefrescar = document.getElementById('btnBoardRefresh');
  if (btnRefrescar) btnRefrescar.addEventListener('click', cargar);

  // Se pinta ahora si la pagina arranca en el tablero; si no, al entrar en el.
  if (tablaVisible()) cargar();

  /* ═══════════════════════════════════════════════════════
     ETIQUETAS: catalogo compartido por el modal y el dialogo
     ═══════════════════════════════════════════════════════ */

  let catalogo = null;

  function cargarCatalogo(forzar) {
    if (catalogo && !forzar) return Promise.resolve(catalogo);
    return requestJson('/api/tasks/tags').then(function (data) {
      catalogo = data.success ? data.tags : [];
      return catalogo;
    });
  }

  function cambiosEnEtiquetas() {
    catalogo = null;
    window.recargarTablero();
    if (typeof window.recargarVistaHoy === 'function') window.recargarVistaHoy();
  }

  function selectorDeColor(contenedor, actual, alElegir) {
    contenedor.innerHTML = COLORES.map(function (c) {
      return `<button type="button" class="etiqueta-color tono-${c.clave}" role="radio" aria-checked="${c.clave === actual}"`
        + ` data-color="${c.clave}" aria-label="${c.nombre}" title="${c.nombre}"></button>`;
    }).join('');
    contenedor.onclick = function (evento) {
      const b = evento.target.closest('[data-color]');
      if (!b) return;
      contenedor.querySelectorAll('[data-color]').forEach(function (x) {
        x.setAttribute('aria-checked', String(x === b));
      });
      alElegir(b.dataset.color);
    };
  }

  /* ─── En el modal de la tarea ─── */

  const grupoEtiquetas = document.getElementById('taskTagsGroup');
  const editorEtiquetas = document.getElementById('taskTagsEditor');
  const modal = { id: null, etiquetas: [], puedeEditar: false, turno: 0 };

  function pintarEditorEtiquetas() {
    if (!editorEtiquetas) return;
    const puestas = new Set(modal.etiquetas.map(function (e) { return Number(e.id); }));
    const lista = catalogo || [];
    // Las puestas que no estan en el catalogo son de otra unidad: se ven pero
    // no se pueden quitar desde aqui.
    const ajenas = modal.etiquetas.filter(function (e) {
      return !lista.some(function (c) { return Number(c.id) === Number(e.id); });
    });
    editorEtiquetas.innerHTML = ''
      + lista.map(function (e) {
        const puesta = puestas.has(Number(e.id));
        return `<button type="button" class="etiqueta etiqueta-alternar tono-${escapeHtml(e.color)}" data-etiqueta="${Number(e.id)}"`
          + ` aria-pressed="${puesta}"${modal.puedeEditar ? '' : ' disabled'}>`
          + `${puesta ? '<i class="fa-solid fa-check" aria-hidden="true"></i> ' : ''}${escapeHtml(e.nombre)}</button>`;
      }).join('')
      + ajenas.map(function (e) {
        return `<span class="etiqueta tono-${escapeHtml(e.color)}" title="De otra unidad">${escapeHtml(e.nombre)}</span>`;
      }).join('')
      + (modal.puedeEditar
        ? '<button type="button" class="etiqueta etiqueta-nueva" data-accion="nueva-etiqueta"><i class="fa-solid fa-plus" aria-hidden="true"></i> Nueva</button>'
        : '')
      + (!lista.length && !modal.puedeEditar ? '<span class="tarea-etiquetas-vacio">Sin etiquetas</span>' : '');
  }

  function guardarEtiquetasDeTarea(ids) {
    const id = modal.id;
    return requestJson(`/api/tasks/${id}/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_ids: ids })
    }).then(function (data) {
      if (!data.success) {
        notify('error', data.error || 'No se pudieron guardar las etiquetas.');
        return;
      }
      if (modal.id === id) {
        modal.etiquetas = data.tags;
        pintarEditorEtiquetas();
      }
      window.recargarTablero();
      if (typeof window.recargarVistaHoy === 'function') window.recargarVistaHoy();
    }).catch(function () { notify('error', 'Error de conexión.'); });
  }

  if (editorEtiquetas) {
    editorEtiquetas.addEventListener('click', function (evento) {
      const alternar = evento.target.closest('[data-etiqueta]');
      if (alternar) {
        const tagId = Number(alternar.dataset.etiqueta);
        const propias = (catalogo || []).map(function (c) { return Number(c.id); });
        let ids = modal.etiquetas.map(function (e) { return Number(e.id); })
          .filter(function (x) { return propias.includes(x); });
        ids = ids.includes(tagId) ? ids.filter(function (x) { return x !== tagId; }) : ids.concat([tagId]);
        guardarEtiquetasDeTarea(ids);
        return;
      }
      if (evento.target.closest('[data-accion="nueva-etiqueta"]')) abrirDialogoEtiquetas(true);
    });
  }

  /* ─── Relaciones en el modal ─── */

  const relacionesEl = document.getElementById('taskRelations');
  const relacionesForm = document.getElementById('taskRelationsForm');
  const relacionesTipo = document.getElementById('taskRelationsType');
  const relacionesBuscar = document.getElementById('taskRelationsSearch');
  const relacionesResultados = document.getElementById('taskRelationsResults');
  const relacionesCuenta = document.getElementById('taskRelationsCount');

  function filaRelacion(t, puedeEditar) {
    return '<li class="relacion' + (t.is_final ? ' is-done' : '') + '">'
      + `<span class="relacion-estado">${escapeHtml(t.status)}</span>`
      + `<span class="relacion-titulo">${escapeHtml(t.title)}</span>`
      + `<span class="relacion-meta">${escapeHtml(t.assignee_name || '')}${t.due_date ? ' · ' + escapeHtml(fechaCorta(t.due_date)) : ''}</span>`
      + (puedeEditar
        ? `<button type="button" class="bandeja-icono-btn" data-quitar-relacion="${Number(t.dependency_id)}" aria-label="Quitar relación con ${escapeHtml(t.title)}">&times;</button>`
        : '')
      + '</li>';
  }

  function pintarRelaciones(data) {
    if (!relacionesEl) return;
    const puede = !!data.can_edit;
    const bloque = function (titulo, lista, ocultas, vacio) {
      return `<h4 class="relaciones-titulo">${titulo}</h4>`
        + (lista.length ? '<ul class="relaciones-lista">' + lista.map(function (t) { return filaRelacion(t, puede); }).join('') + '</ul>' : '')
        + (ocultas ? `<p class="relaciones-nota">Y ${ocultas} de otra unidad que no puedes ver.</p>` : '')
        + (!lista.length && !ocultas ? `<p class="relaciones-nota">${vacio}</p>` : '');
    };
    relacionesEl.innerHTML = ''
      + bloque('<i class="fa-solid fa-lock" aria-hidden="true"></i> Bloqueada por', data.blocked_by, data.hidden_blocked_by,
        'Nada tiene que cerrarse antes que esta tarea.')
      + bloque('<i class="fa-solid fa-arrow-right" aria-hidden="true"></i> Bloquea a', data.blocks, data.hidden_blocks,
        'Ninguna tarea espera por esta.');
    if (relacionesForm) relacionesForm.classList.toggle('modal-hidden', !puede);
    if (relacionesCuenta) {
      relacionesCuenta.textContent = String(data.blocked_by.length + data.blocks.length
        + (data.hidden_blocked_by || 0) + (data.hidden_blocks || 0));
    }
  }

  function cargarRelaciones() {
    const id = modal.id;
    if (!id) return Promise.resolve();
    return requestJson(`/api/tasks/${id}/dependencies`).then(function (data) {
      if (modal.id !== id) return;
      if (data.success) pintarRelaciones(data);
      else if (relacionesEl) relacionesEl.innerHTML = `<div class="task-comments-empty">${escapeHtml(data.error || 'No se pudieron cargar.')}</div>`;
    }).catch(function () {});
  }

  function cerrarResultados() {
    if (!relacionesResultados) return;
    relacionesResultados.classList.remove('visible');
    relacionesResultados.innerHTML = '';
  }

  let temporizadorBusqueda = null;
  if (relacionesBuscar) {
    relacionesBuscar.addEventListener('input', function () {
      clearTimeout(temporizadorBusqueda);
      const q = relacionesBuscar.value.trim();
      if (q.length < 2) { cerrarResultados(); return; }
      temporizadorBusqueda = setTimeout(function () {
        const id = modal.id;
        fetch('/api/tasks?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (tareas) {
          if (modal.id !== id || !Array.isArray(tareas)) return;
          const candidatas = tareas.filter(function (t) { return Number(t.id) !== Number(id); }).slice(0, 8);
          relacionesResultados.innerHTML = candidatas.length
            ? candidatas.map(function (t) {
              return `<div class="autocomplete-item" role="option" tabindex="0" data-candidata="${Number(t.id)}">`
                + `${escapeHtml(t.title)} <small>· ${escapeHtml(t.status)} · ${escapeHtml(t.assignee_name || '')}</small></div>`;
            }).join('')
            : '<div class="autocomplete-item">Sin resultados</div>';
          relacionesResultados.classList.add('visible');
        }).catch(function () {});
      }, 300);
    });
  }

  function anadirRelacion(otraId) {
    const id = modal.id;
    requestJson(`/api/tasks/${id}/dependencies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: relacionesTipo.value, task_id: otraId })
    }).then(function (data) {
      if (!data.success) { notify('error', data.error || 'No se pudo crear la relación.'); return; }
      relacionesBuscar.value = '';
      cerrarResultados();
      cargarRelaciones();
      window.recargarTablero();
    }).catch(function () { notify('error', 'Error de conexión.'); });
  }

  if (relacionesResultados) {
    relacionesResultados.addEventListener('click', function (evento) {
      const op = evento.target.closest('[data-candidata]');
      if (op) anadirRelacion(Number(op.dataset.candidata));
    });
    relacionesResultados.addEventListener('keydown', function (evento) {
      const op = evento.target.closest('[data-candidata]');
      if (op && (evento.key === 'Enter' || evento.key === ' ')) {
        evento.preventDefault();
        anadirRelacion(Number(op.dataset.candidata));
      }
    });
  }
  if (relacionesForm) relacionesForm.addEventListener('submit', function (e) { e.preventDefault(); });

  if (relacionesEl) {
    relacionesEl.addEventListener('click', function (evento) {
      const b = evento.target.closest('[data-quitar-relacion]');
      if (!b) return;
      requestJson(`/api/tasks/${modal.id}/dependencies/${Number(b.dataset.quitarRelacion)}`, { method: 'DELETE' })
        .then(function (data) {
          if (!data.success) { notify('error', data.error || 'No se pudo quitar.'); return; }
          cargarRelaciones();
          window.recargarTablero();
        }).catch(function () { notify('error', 'Error de conexión.'); });
    });
  }

  /* tasks.js llama aqui cada vez que abre el modal: null al crear. */
  app.alAbrirTarea = function (task) {
    const turno = ++modal.turno;
    modal.id = task ? Number(task.id) : null;
    modal.etiquetas = (task && task.tags) || [];
    modal.puedeEditar = !!(task && task.can_edit !== false);
    if (relacionesBuscar) relacionesBuscar.value = '';
    cerrarResultados();
    if (relacionesCuenta) relacionesCuenta.textContent = '0';
    if (grupoEtiquetas) grupoEtiquetas.classList.toggle('modal-hidden', !task);
    if (!task) return;

    if (relacionesEl) relacionesEl.innerHTML = '<div class="task-comments-empty">Cargando relaciones…</div>';
    pintarEditorEtiquetas();
    // El modal puede abrirse con datos del calendario, que no traen etiquetas
    // ni permisos: se piden aparte junto con el catalogo.
    Promise.all([cargarCatalogo(), requestJson(`/api/tasks/${modal.id}`)]).then(function (res) {
      if (turno !== modal.turno) return;
      const detalle = res[1] && res[1].task;
      if (detalle) {
        modal.etiquetas = detalle.tags || [];
        modal.puedeEditar = detalle.can_edit !== false;
      }
      pintarEditorEtiquetas();
    }).catch(function () {});
    cargarRelaciones();
  };

  /* ═══════════════════════════════════════════════════════
     DIALOGO DE GESTION DE ETIQUETAS
     ═══════════════════════════════════════════════════════ */

  const dialogo = document.getElementById('tagsDialogOverlay');
  const dialogoLista = document.getElementById('tagsDialogList');
  const dialogoForm = document.getElementById('tagsDialogForm');
  const dialogoNombre = document.getElementById('tagsDialogName');
  const dialogoColores = document.getElementById('tagsDialogColors');
  const dialogoCerrar = document.getElementById('tagsDialogClose');
  let colorNuevo = 'info';
  let ponerAlCrear = false;
  let focoPrevio = null;

  function pintarDialogo() {
    const lista = catalogo || [];
    dialogoLista.innerHTML = lista.length ? lista.map(function (e) {
      const id = Number(e.id);
      if (!e.can_manage) {
        return `<li class="tablero-etiqueta-fila">${chipEtiqueta(e)}<span class="relaciones-nota">${e.area_id ? escapeHtml(e.area_name) : 'Común'}</span></li>`;
      }
      return `<li class="tablero-etiqueta-fila" data-gestion="${id}">`
        + `<span class="etiqueta-punto tono-${escapeHtml(e.color)}" aria-hidden="true"></span>`
        + `<label class="visually-hidden" for="tagName${id}">Nombre</label>`
        + `<input type="text" class="form-input" id="tagName${id}" value="${escapeHtml(e.nombre)}" maxlength="40" data-renombrar="${id}">`
        + `<div class="etiqueta-colores" role="radiogroup" aria-label="Color de ${escapeHtml(e.nombre)}" data-colores="${id}"></div>`
        + `<button type="button" class="bandeja-icono-btn" data-borrar-etiqueta="${id}" aria-label="Borrar ${escapeHtml(e.nombre)}"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>`
        + '</li>';
    }).join('') : '<li class="relaciones-nota">Todavía no hay etiquetas.</li>';

    lista.filter(function (e) { return e.can_manage; }).forEach(function (e) {
      const cont = dialogoLista.querySelector(`[data-colores="${Number(e.id)}"]`);
      selectorDeColor(cont, e.color, function (color) { editarEtiqueta(e, { color: color }); });
    });
  }

  function editarEtiqueta(e, cambios) {
    requestJson(`/api/tasks/tags/${Number(e.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ nombre: e.nombre, color: e.color }, cambios))
    }).then(function (data) {
      if (!data.success) { notify('error', data.error || 'No se pudo guardar.'); }
      cambiosEnEtiquetas();
      return cargarCatalogo(true).then(function () { pintarDialogo(); pintarEditorEtiquetas(); });
    }).catch(function () { notify('error', 'Error de conexión.'); });
  }

  function abrirDialogoEtiquetas(desdeModal) {
    if (!dialogo) return;
    ponerAlCrear = !!desdeModal && !!modal.id;
    focoPrevio = document.activeElement;
    colorNuevo = 'info';
    selectorDeColor(dialogoColores, colorNuevo, function (c) { colorNuevo = c; });
    dialogoNombre.value = '';
    window.abrirModal(dialogo);
    cargarCatalogo(true).then(pintarDialogo);
    setTimeout(function () { dialogoNombre.focus(); }, 30);
  }

  function cerrarDialogo() {
    window.cerrarModal(dialogo);
    if (focoPrevio && typeof focoPrevio.focus === 'function') focoPrevio.focus();
  }

  if (dialogo) {
    document.getElementById('btnBoardTags').addEventListener('click', function () { abrirDialogoEtiquetas(false); });
    dialogoCerrar.addEventListener('click', cerrarDialogo);
    dialogo.addEventListener('click', function (e) { if (e.target === dialogo) cerrarDialogo(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dialogo.classList.contains('open')) {
        e.stopPropagation();
        cerrarDialogo();
      }
    }, true);

    dialogoForm.addEventListener('submit', function (evento) {
      evento.preventDefault();
      const nombre = dialogoNombre.value.trim();
      if (!nombre) { dialogoNombre.focus(); return; }
      requestJson('/api/tasks/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombre, color: colorNuevo })
      }).then(function (data) {
        if (!data.success) { notify('error', data.error || 'No se pudo crear.'); return; }
        dialogoNombre.value = '';
        cambiosEnEtiquetas();
        return cargarCatalogo(true).then(function () {
          pintarDialogo();
          // Creada desde una tarea, se le pone a esa tarea: es lo que se queria.
          if (ponerAlCrear && modal.id) {
            const propias = catalogo.map(function (c) { return Number(c.id); });
            const ids = modal.etiquetas.map(function (e) { return Number(e.id); })
              .filter(function (x) { return propias.includes(x); }).concat([Number(data.tag.id)]);
            guardarEtiquetasDeTarea(ids);
            cerrarDialogo();
          } else {
            pintarEditorEtiquetas();
          }
        });
      }).catch(function () { notify('error', 'Error de conexión.'); });
    });

    dialogoLista.addEventListener('change', function (evento) {
      const input = evento.target.closest('[data-renombrar]');
      if (!input) return;
      const e = (catalogo || []).find(function (c) { return Number(c.id) === Number(input.dataset.renombrar); });
      if (e && input.value.trim() && input.value.trim() !== e.nombre) editarEtiqueta(e, { nombre: input.value.trim() });
    });

    dialogoLista.addEventListener('click', function (evento) {
      const b = evento.target.closest('[data-borrar-etiqueta]');
      if (!b) return;
      const e = (catalogo || []).find(function (c) { return Number(c.id) === Number(b.dataset.borrarEtiqueta); });
      if (!e) return;
      const confirmar = typeof window.appConfirm === 'function'
        ? window.appConfirm({
          title: 'Borrar etiqueta',
          message: `Se quitará "${e.nombre}" de todas las tareas que la llevan.`,
          confirmText: 'Borrar',
          danger: true
        })
        : Promise.resolve(false);
      confirmar.then(function (ok) {
        if (!ok) return;
        requestJson(`/api/tasks/tags/${Number(e.id)}`, { method: 'DELETE' }).then(function (data) {
          if (!data.success) { notify('error', data.error || 'No se pudo borrar.'); return; }
          cambiosEnEtiquetas();
          modal.etiquetas = modal.etiquetas.filter(function (x) { return Number(x.id) !== Number(e.id); });
          return cargarCatalogo(true).then(function () { pintarDialogo(); pintarEditorEtiquetas(); });
        }).catch(function () { notify('error', 'Error de conexión.'); });
      });
    });
  }
});

/*
 * static/js/task_request_form.js
 * ------------------------------
 * Formulario de solicitud a otra unidad.
 *
 * Vivia dentro de tasks.js, asi que solo existia en Mis tareas: la pagina de
 * Solicitudes mostraba solicitudes pero no dejaba crear ninguna. Al moverlo
 * aqui lo comparten las dos sin duplicar nada.
 *
 * Lo abre cualquier elemento con [data-abrir-solicitud]. Al enviarse emite
 * "solicitud:enviada" en document, para que la pagina que quiera refrescar su
 * lista lo haga sin que este modulo sepa nada de ella.
 */
document.addEventListener('DOMContentLoaded', function () {
  const modal = document.getElementById('taskRequestModal');
  if (!modal) return;

  const btnCerrar = document.getElementById('taskRequestClose');
  const btnCancelar = document.getElementById('taskRequestCancel');
  const btnEnviar = document.getElementById('btnTaskRequestSend');
  const selArea = document.getElementById('taskRequestArea');
  const inpTitulo = document.getElementById('taskRequestTitle');
  const inpDesc = document.getElementById('taskRequestDesc');
  const inpCliente = document.getElementById('taskRequestClient');
  const selPrioridad = document.getElementById('taskRequestPriority');
  const inpFecha = document.getElementById('taskRequestDueDate');
  const aviso = document.getElementById('taskRequestMessage');

  function notificar(tipo, mensaje) {
    if (typeof window.appNotify === 'function') {
      window.appNotify({ type: tipo, message: mensaje });
    }
  }

  function limpiarAviso() {
    if (aviso) aviso.textContent = '';
  }

  function cargarUnidades() {
    if (!selArea) return;
    selArea.innerHTML = '<option value="">Cargando...</option>';
    fetch('/api/areas')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success || !Array.isArray(data.areas)) {
          selArea.innerHTML = '<option value="">No se pudieron cargar las unidades</option>';
          return;
        }
        selArea.innerHTML = '<option value="">Selecciona unidad...</option>';
        data.areas.forEach(function (a) {
          const o = document.createElement('option');
          o.value = a.id;
          o.textContent = a.name;
          selArea.appendChild(o);
        });
      })
      .catch(function () {
        selArea.innerHTML = '<option value="">Error de conexión</option>';
      });
  }

  function abrir() {
    window.abrirModal(modal);
    limpiarAviso();
    cargarUnidades();
    if (inpTitulo) inpTitulo.value = '';
    if (inpDesc) inpDesc.value = '';
    if (inpCliente) inpCliente.value = '';
    if (selPrioridad) selPrioridad.value = 'Media';
    if (inpFecha) inpFecha.value = '';
    if (inpTitulo) inpTitulo.focus();
  }

  function cerrar() {
    window.cerrarModal(modal);
  }

  function enviar() {
    if (!selArea || !inpTitulo) return;

    const areaId = selArea.value;
    const titulo = (inpTitulo.value || '').trim();

    if (!areaId) {
      if (aviso) aviso.textContent = 'Selecciona una unidad destino.';
      selArea.focus();
      return;
    }
    if (!titulo) {
      if (aviso) aviso.textContent = 'El título es obligatorio.';
      inpTitulo.focus();
      return;
    }

    btnEnviar.disabled = true;
    fetch('/api/task-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: titulo,
        to_area_id: Number(areaId),
        description: (inpDesc ? inpDesc.value : '') || undefined,
        client: (inpCliente ? inpCliente.value : '') || undefined,
        priority: selPrioridad ? selPrioridad.value : 'Media',
        due_date: inpFecha ? (inpFecha.value || undefined) : undefined
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) {
          if (aviso) aviso.textContent = data.error || 'No se pudo enviar la solicitud.';
          return;
        }
        cerrar();
        notificar('success', 'Solicitud enviada.');
        // La pagina de Solicitudes la escucha para recargar su lista; Mis
        // tareas la ignora. El modulo no necesita saber en cual esta.
        document.dispatchEvent(new CustomEvent('solicitud:enviada'));
      })
      .catch(function () {
        if (aviso) aviso.textContent = 'Error de conexión.';
      })
      .finally(function () {
        btnEnviar.disabled = false;
      });
  }

  document.querySelectorAll('[data-abrir-solicitud]').forEach(function (disparador) {
    disparador.addEventListener('click', abrir);
  });

  if (btnCerrar) btnCerrar.addEventListener('click', cerrar);
  if (btnCancelar) btnCancelar.addEventListener('click', cerrar);
  if (btnEnviar) btnEnviar.addEventListener('click', enviar);

  modal.addEventListener('click', function (e) {
    if (e.target === modal) cerrar();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('open')) cerrar();
  });
});

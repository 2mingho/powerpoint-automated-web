/* Task Requests — cross-area request management */

document.addEventListener('DOMContentLoaded', function () {
  const tabs = document.querySelectorAll('.tr-tabs .task-tab');
  const receivedList = document.getElementById('trReceivedList');
  const sentList = document.getElementById('trSentList');
  const receivedBadge = document.getElementById('trReceivedBadge');
  const sentCount = document.getElementById('trSentCount');
  const receivedBadgeInline = document.getElementById('trReceivedBadgeInline');
  const sentBadgeInline = document.getElementById('trSentBadgeInline');

  const acceptModal = document.getElementById('trAcceptModal');
  const acceptClose = document.getElementById('trAcceptClose');
  const acceptCancel = document.getElementById('trAcceptCancel');
  const acceptConfirm = document.getElementById('trAcceptConfirm');
  const acceptAssignee = document.getElementById('trAcceptAssignee');
  const acceptDueDate = document.getElementById('trAcceptDueDate');

  const rejectModal = document.getElementById('trRejectModal');
  const rejectClose = document.getElementById('trRejectClose');
  const rejectCancel = document.getElementById('trRejectCancel');
  const rejectConfirm = document.getElementById('trRejectConfirm');
  const rejectReason = document.getElementById('trRejectReason');

  let currentRequestId = null;
  let currentRejectRequestId = null;

  /* ── Tab switching ── */
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      document.querySelectorAll('.tr-tabs ~ .task-tab-panel').forEach(function (p) { p.classList.remove('active'); });
      const panel = document.getElementById('trTab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1));
      if (panel) panel.classList.add('active');
    });
  });

  /* ── Helpers ── */
  function parseJsonResponse(response) {
    return response.json().catch(function () {
      return { success: false, error: 'Respuesta inválida del servidor.' };
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function notify(kind, message) {
    // Reuse existing notify function if available
    if (window.notify) { window.notify(kind, message); return; }
    // Fallback
    console.log('[' + kind + '] ' + message);
  }

  function statusClass(status) {
    var map = { 'Pendiente': 'st-pendiente', 'Aceptada': 'st-completado', 'Rechazada': 'st-bloqueado', 'Cancelada': '' };
    return map[status] || '';
  }

  function statusLabel(status) {
    var map = { 'Pendiente': 'Pendiente', 'Aceptada': 'Aceptada', 'Rechazada': 'Rechazada', 'Cancelada': 'Cancelada' };
    return map[status] || status;
  }

  function renderMetaChip(icon, text) {
    return '<span class="tr-request-chip"><i class="fa-solid ' + icon + '"></i> ' + escapeHtml(text) + '</span>';
  }

  function renderRequestCard(req, isReceived) {
    var actions = '';
    if (isReceived && req.status === 'Pendiente') {
      actions = '<button type="button" class="btn btn-primary btn-sm tr-btn-accept" data-id="' + req.id + '">Aceptar</button>'
        + ' <button type="button" class="btn btn-danger btn-sm tr-btn-reject" data-id="' + req.id + '">Rechazar</button>';
    }
    if (!isReceived && req.status === 'Pendiente') {
      actions = '<button type="button" class="btn btn-secondary btn-sm tr-btn-cancel" data-id="' + req.id + '">Cancelar</button>';
    }
    return '<article class="tr-request-card">'
      + '<div class="tr-request-top">'
      + '<div>'
      + '<p class="tr-request-kicker">' + escapeHtml(isReceived ? 'De ' + (req.from_area_name || 'otra unidad') : 'Para ' + (req.to_area_name || 'otra unidad')) + '</p>'
      + '<h3 class="tr-request-title">' + escapeHtml(req.title) + '</h3>'
      + '</div>'
      + '<span class="task-status-dot tr-status-pill ' + statusClass(req.status) + '">' + escapeHtml(statusLabel(req.status)) + '</span>'
      + '</div>'
      + '<p>' + escapeHtml(req.client || 'Sin cliente') + ' · ' + escapeHtml(req.requester_name || 'Sin solicitante') + '</p>'
      + '<div class="tr-request-meta">'
      + renderMetaChip('fa-flag', 'Prioridad ' + (req.priority || 'Media'))
      + (req.due_date ? renderMetaChip('fa-calendar-day', 'Entrega ' + req.due_date) : '')
      + (req.description ? renderMetaChip('fa-align-left', req.description) : '')
      + '</div>'
      + (req.rejection_reason ? '<div class="tr-request-reason"><i class="fa-solid fa-circle-info"></i> ' + escapeHtml(req.rejection_reason) + '</div>' : '')
      + '<div class="tr-request-actions">' + actions + '</div>'
      + '</article>';
  }

  function loadRequests() {
    // Received
    fetch('/api/task-requests?direction=received')
      .then(parseJsonResponse)
      .then(function (data) {
        if (!data.success || !Array.isArray(data.requests)) {
          if (receivedList) receivedList.innerHTML = '<div class="task-comments-empty">Error al cargar.</div>';
          return;
        }
        var pending = 0;
        receivedList.innerHTML = data.requests.length
          ? data.requests.map(function (r) { if (r.status === 'Pendiente') pending++; return renderRequestCard(r, true); }).join('')
          : '<div class="task-comments-empty">Ninguna unidad te ha pedido trabajo todavia. Cuando lo hagan, apareceran aqui para aceptarlas o rechazarlas.</div>';
        if (receivedBadge) receivedBadge.textContent = String(pending);
        if (receivedBadgeInline) receivedBadgeInline.textContent = String(pending);
      });

    // Sent
    fetch('/api/task-requests?direction=sent')
      .then(parseJsonResponse)
      .then(function (data) {
        if (!data.success || !Array.isArray(data.requests)) {
          if (sentList) sentList.innerHTML = '<div class="task-comments-empty">Error al cargar.</div>';
          return;
        }
        if (sentCount) sentCount.textContent = String(data.requests.length);
        if (sentBadgeInline) sentBadgeInline.textContent = String(data.requests.length);
        sentList.innerHTML = data.requests.length
          ? data.requests.map(function (r) { return renderRequestCard(r, false); }).join('')
          : '<div class="task-comments-empty">No has pedido trabajo a otra unidad. Usa Nueva solicitud para derivar algo sin asignarlo tu.</div>';
      });
  }

  /* ── Accept flow ── */
  function openAcceptModal(requestId) {
    currentRequestId = requestId;
    acceptAssignee.innerHTML = '<option value="">Cargando...</option>';
    acceptDueDate.value = '';
    window.abrirModal(acceptModal);

    // Load team users for assignee select
    fetch('/api/team/tasks/filters')
      .then(parseJsonResponse)
      .then(function (data) {
        acceptAssignee.innerHTML = '<option value="">Selecciona un usuario...</option>';
        if (Array.isArray(data.users)) {
          data.users.forEach(function (u) {
            var opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = u.label || u.username;
            acceptAssignee.appendChild(opt);
          });
        }
      })
      .catch(function () {
        acceptAssignee.innerHTML = '<option value="">Error al cargar usuarios</option>';
      });
  }

  function closeAcceptModal() {
    window.cerrarModal(acceptModal);
    currentRequestId = null;
  }

  function openRejectModal(requestId) {
    currentRejectRequestId = requestId;
    if (rejectReason) rejectReason.value = '';
    if (rejectModal) window.abrirModal(rejectModal);
  }

  function closeRejectModal() {
    if (rejectModal) window.cerrarModal(rejectModal);
    currentRejectRequestId = null;
  }

  function confirmAccept() {
    if (!currentRequestId) return;
    var assignee = acceptAssignee.value;
    var dueDate = acceptDueDate.value;
    if (!assignee) { notify('error', 'Debes seleccionar un asignado.'); return; }

    acceptConfirm.disabled = true;
    fetch('/api/task-requests/' + currentRequestId + '/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_id: Number(assignee), due_date: dueDate || undefined })
    })
      .then(parseJsonResponse)
      .then(function (data) {
        if (!data.success) { notify('error', data.error || 'Error al aceptar.'); return; }
        notify('success', 'Solicitud aceptada. Tarea creada.');
        closeAcceptModal();
        loadRequests();
      })
      .catch(function () { notify('error', 'Error de conexión.'); })
      .finally(function () { acceptConfirm.disabled = false; });
  }

  /* ── Reject flow ── */
  function rejectRequest(requestId) {
    openRejectModal(requestId);
  }

  function confirmReject() {
    if (!currentRejectRequestId) return;
    var reason = (rejectReason ? rejectReason.value : '').trim();
    if (reason.length < 5) {
      notify('error', 'Debes proporcionar una razón (mín. 5 caracteres).');
      return;
    }
    if (rejectConfirm) rejectConfirm.disabled = true;
    fetch('/api/task-requests/' + currentRejectRequestId + '/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() })
    })
      .then(parseJsonResponse)
      .then(function (data) {
        if (!data.success) { notify('error', data.error || 'Error al rechazar.'); return; }
        notify('success', 'Solicitud rechazada.');
        closeRejectModal();
        loadRequests();
      })
      .catch(function () { notify('error', 'Error de conexión.'); })
      .finally(function () { if (rejectConfirm) rejectConfirm.disabled = false; });
  }

  /* ── Cancel flow ── */
  function cancelRequest(requestId) {
    if (!confirm('¿Cancelar esta solicitud?')) return;
    fetch('/api/task-requests/' + requestId + '/cancel', { method: 'POST' })
      .then(parseJsonResponse)
      .then(function (data) {
        if (!data.success) { notify('error', data.error || 'Error al cancelar.'); return; }
        notify('success', 'Solicitud cancelada.');
        loadRequests();
      })
      .catch(function () { notify('error', 'Error de conexión.'); });
  }

  /* ── Event delegation ── */
  receivedList.addEventListener('click', function (event) {
    var target = event.target;
    var acceptBtn = target.closest('.tr-btn-accept');
    if (acceptBtn) { openAcceptModal(acceptBtn.dataset.id); return; }
    var rejectBtn = target.closest('.tr-btn-reject');
    if (rejectBtn) { rejectRequest(rejectBtn.dataset.id); }
  });

  sentList.addEventListener('click', function (event) {
    var target = event.target;
    var cancelBtn = target.closest('.tr-btn-cancel');
    if (cancelBtn) { cancelRequest(cancelBtn.dataset.id); }
  });

  /* ── Modal events ── */
  if (acceptClose) acceptClose.addEventListener('click', closeAcceptModal);
  if (acceptCancel) acceptCancel.addEventListener('click', closeAcceptModal);
  if (acceptConfirm) acceptConfirm.addEventListener('click', confirmAccept);
  if (acceptModal) acceptModal.addEventListener('click', function (e) { if (e.target === acceptModal) closeAcceptModal(); });

  if (rejectClose) rejectClose.addEventListener('click', closeRejectModal);
  if (rejectCancel) rejectCancel.addEventListener('click', closeRejectModal);
  if (rejectConfirm) rejectConfirm.addEventListener('click', confirmReject);
  if (rejectModal) rejectModal.addEventListener('click', function (e) { if (e.target === rejectModal) closeRejectModal(); });

  // El formulario de solicitud es un modulo aparte y no conoce esta pagina:
  // avisa por un evento y aqui se decide que hacer con el.
  document.addEventListener('solicitud:enviada', loadRequests);

  /* ── Initial load ── */
  loadRequests();
});

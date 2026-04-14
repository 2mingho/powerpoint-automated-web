/* ═══════════════════════════════════════════════════════
   Tasks — FullCalendar + CRUD + Client Autocomplete
   ═══════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {
  // ─── DOM refs ───
  const calEl       = document.getElementById('tasksCalendar');
  const overlay     = document.getElementById('taskModalOverlay');
  const btnNew      = document.getElementById('btnNewTask');
  const btnClose    = document.getElementById('taskModalClose');
  const btnCancel   = document.getElementById('btnCancelTask');
  const btnSave     = document.getElementById('btnSaveTask');
  const btnDelete   = document.getElementById('btnDeleteTask');
  const modalTitle  = document.getElementById('taskModalTitle');
  const statusGroup = document.getElementById('statusGroup');
  const recurrentCb = document.getElementById('taskRecurrent');
  const recFields   = document.getElementById('recurrenceFields');

  // Form fields
  const fId       = document.getElementById('taskId');
  const fTitle    = document.getElementById('taskTitle');
  const fClient   = document.getElementById('taskClient');
  const fDesc     = document.getElementById('taskDesc');
  const fAssignee = document.getElementById('taskAssignee');
  const fDueDate  = document.getElementById('taskDueDate');
  const fRecType  = document.getElementById('taskRecurrenceType');
  const fRecEnd   = document.getElementById('taskRecurrenceEnd');

  let currentStatus = 'Pendiente';
  let calendar;

  // ─── STATUS CHIPS ───
  document.querySelectorAll('.status-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.status-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      currentStatus = chip.dataset.status;
    });
  });

  // ─── RECURRENCE TOGGLE ───
  recurrentCb.addEventListener('change', () => {
    recFields.classList.toggle('visible', recurrentCb.checked);
  });

  // ─── CLIENT AUTOCOMPLETE ───
  const acList = document.getElementById('clientAutocomplete');
  let clientCache = [];

  function loadClients() {
    fetch('/api/tasks/clients')
      .then(r => r.json())
      .then(data => { clientCache = data; });
  }
  loadClients();

  fClient.addEventListener('input', function () {
    const val = this.value.trim().toLowerCase();
    acList.innerHTML = '';
    if (!val) { acList.classList.remove('visible'); return; }

    const matches = clientCache.filter(c => c.toLowerCase().includes(val));
    if (matches.length === 0) { acList.classList.remove('visible'); return; }

    matches.forEach(m => {
      const div = document.createElement('div');
      div.className = 'autocomplete-item';
      div.textContent = m;
      div.addEventListener('click', () => {
        fClient.value = m;
        acList.classList.remove('visible');
      });
      acList.appendChild(div);
    });
    acList.classList.add('visible');
  });

  fClient.addEventListener('blur', () => {
    setTimeout(() => acList.classList.remove('visible'), 200);
  });

  // ─── MODAL OPEN / CLOSE ───
  function openModal(editMode, taskData) {
    fId.value = '';
    fTitle.value = '';
    fClient.value = '';
    fDesc.value = '';
    fDueDate.value = '';
    recurrentCb.checked = false;
    recFields.classList.remove('visible');
    fRecType.value = 'Semanal';
    fRecEnd.value = '';
    currentStatus = 'Pendiente';

    document.querySelectorAll('.status-chip').forEach(c => c.classList.remove('selected'));
    document.querySelector('.status-chip[data-status="Pendiente"]').classList.add('selected');

    if (editMode && taskData) {
      modalTitle.textContent = 'Editar Tarea';
      fId.value = taskData.id;
      fTitle.value = taskData.title || '';
      fClient.value = taskData.client || '';
      fDesc.value = taskData.description || '';
      fAssignee.value = taskData.assignee_id;
      fDueDate.value = taskData.due_date || '';
      currentStatus = taskData.status || 'Pendiente';

      document.querySelectorAll('.status-chip').forEach(c => {
        c.classList.toggle('selected', c.dataset.status === currentStatus);
      });

      statusGroup.style.display = '';
      btnDelete.style.display = '';

      // Hide recurrence options in edit mode
      recurrentCb.checked = false;
      recurrentCb.parentElement.style.display = 'none';
      recFields.classList.remove('visible');
    } else {
      modalTitle.textContent = 'Nueva Tarea';
      statusGroup.style.display = 'none';
      btnDelete.style.display = 'none';
      recurrentCb.parentElement.style.display = '';
    }

    overlay.classList.add('open');
    fTitle.focus();
  }

  function closeModal() {
    overlay.classList.remove('open');
  }

  btnNew.addEventListener('click', () => openModal(false));
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
  });

  // ─── SAVE (CREATE / UPDATE) ───
  btnSave.addEventListener('click', function () {
    const id = fId.value;
    const payload = {
      title: fTitle.value.trim(),
      client: fClient.value.trim(),
      description: fDesc.value.trim(),
      assignee_id: parseInt(fAssignee.value),
      due_date: fDueDate.value,
      status: currentStatus,
      is_recurrent: recurrentCb.checked,
      recurrence_type: recurrentCb.checked ? fRecType.value : '',
      recurrence_end: recurrentCb.checked ? fRecEnd.value : '',
    };

    if (!payload.title) { fTitle.focus(); return; }
    if (!payload.due_date) { fDueDate.focus(); return; }

    const url = id ? `/api/tasks/${id}` : '/api/tasks';
    const method = id ? 'PUT' : 'POST';

    btnSave.disabled = true;
    btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          closeModal();
          calendar.refetchEvents();
          loadClients(); // refresh client autocomplete cache
        } else {
          alert(data.error || 'Error al guardar la tarea.');
        }
      })
      .catch(() => alert('Error de conexión.'))
      .finally(() => {
        btnSave.disabled = false;
        btnSave.innerHTML = '<i class="fa-solid fa-check"></i> Guardar';
      });
  });

  // ─── DELETE ───
  btnDelete.addEventListener('click', function () {
    const id = fId.value;
    if (!id) return;
    if (!confirm('¿Estás seguro de que quieres eliminar esta tarea?')) return;

    fetch(`/api/tasks/${id}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          closeModal();
          calendar.refetchEvents();
        } else {
          alert(data.error || 'Error al eliminar.');
        }
      })
      .catch(() => alert('Error de conexión.'));
  });

  // ─── FULLCALENDAR INIT ───
  const statusColorMap = {
    'Pendiente':   { bg: 'var(--c-warning-bg)', border: 'var(--c-warning)', text: 'var(--c-warning)' },
    'En Progreso': { bg: '#dbeafe',             border: '#2563eb',          text: '#2563eb' },
    'Completado':  { bg: 'var(--c-success-bg)', border: 'var(--c-success)', text: 'var(--c-success)' },
  };

  calendar = new FullCalendar.Calendar(calEl, {
    initialView: 'dayGridMonth',
    locale: 'es',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,dayGridWeek,listWeek'
    },
    buttonText: {
      today: 'Hoy',
      month: 'Mes',
      week: 'Semana',
      list: 'Lista'
    },
    height: 'auto',
    editable: true,     // drag-and-drop
    selectable: true,
    dayMaxEvents: 4,
    moreLinkText: 'más',

    // Fetch events from API
    events: function (info, successCallback, failureCallback) {
      const params = new URLSearchParams({
        start: info.startStr,
        end: info.endStr,
      });
      fetch('/api/tasks?' + params.toString())
        .then(r => r.json())
        .then(tasks => {
          const events = tasks.map(t => {
            const colors = statusColorMap[t.status] || statusColorMap['Pendiente'];
            const slug = t.status.toLowerCase().replace(/\s+/g, '-');
            return {
              id: t.id,
              title: t.title,
              start: t.due_date,
              allDay: true,
              backgroundColor: colors.bg,
              borderColor: colors.border,
              textColor: colors.text,
              classNames: ['fc-event-task', `status-${slug}`],
              extendedProps: t,
            };
          });
          successCallback(events);
        })
        .catch(failureCallback);
    },

    // Click on a date → create task for that day
    dateClick: function (info) {
      openModal(false);
      fDueDate.value = info.dateStr;
    },

    // Click on an event → edit
    eventClick: function (info) {
      info.jsEvent.preventDefault();
      openModal(true, info.event.extendedProps);
    },

    // Drag-and-drop → update due_date
    eventDrop: function (info) {
      const taskId = info.event.id;
      const newDate = info.event.startStr;
      fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: newDate }),
      })
        .then(r => r.json())
        .then(data => {
          if (!data.success) {
            info.revert();
            alert(data.error || 'No se pudo mover la tarea.');
          }
        })
        .catch(() => info.revert());
    },

    // Responsive views
    windowResize: function () {
      if (window.innerWidth < 768) {
        calendar.changeView('listWeek');
      }
    },
  });

  calendar.render();

  // Handle responsive on initial load
  if (window.innerWidth < 768) {
    calendar.changeView('listWeek');
  }
});

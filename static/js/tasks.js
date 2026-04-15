/* ═══════════════════════════════════════════════════════
   Tasks — FullCalendar + CRUD + Client Autocomplete
   ═══════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {
  // ─── DOM refs ───
  const calEl = document.getElementById('tasksCalendar');
  const overlay = document.getElementById('taskModalOverlay');
  const btnNew = document.getElementById('btnNewTask');
  const btnClose = document.getElementById('taskModalClose');
  const btnCancel = document.getElementById('btnCancelTask');
  const btnSave = document.getElementById('btnSaveTask');
  const btnDelete = document.getElementById('btnDeleteTask');
  const modalTitle = document.getElementById('taskModalTitle');
  const statusGroup = document.getElementById('statusGroup');
  const recurrentCb = document.getElementById('taskRecurrent');
  const recFields = document.getElementById('recurrenceFields');

  // Form fields
  const fId = document.getElementById('taskId');
  const fTitle = document.getElementById('taskTitle');
  const fClient = document.getElementById('taskClient');
  const fDesc = document.getElementById('taskDesc');
  const fAssignee = document.getElementById('taskAssignee');
  const fDueDate = document.getElementById('taskDueDate');
  const fRecType = document.getElementById('taskRecurrenceType');
  const fRecEnd = document.getElementById('taskRecurrenceEnd');

  const COPY_STORAGE_KEY = 'tasksClipboard_v1';
  const LONG_PRESS_DELAY = 480;
  const LONG_PRESS_MOVE_THRESHOLD = 12;
  const MOBILE_BREAKPOINT = 768;
  const ICON_ONLY_BREAKPOINT = 390;
  const VIEW_BUTTON_CONFIG = [
    {
      selector: '.fc-dayGridMonth-button',
      icon: 'fa-calendar-days',
      compactLabel: 'Mes',
      ariaLabel: 'Vista mes',
    },
    {
      selector: '.fc-dayGridWeek-button',
      icon: 'fa-calendar-week',
      compactLabel: 'Sem',
      ariaLabel: 'Vista semana',
    },
    {
      selector: '.fc-listWeek-button',
      icon: 'fa-list-ul',
      compactLabel: 'Lista',
      ariaLabel: 'Vista lista',
    },
  ];

  let currentStatus = 'Pendiente';
  let calendar;
  let copiedTask = null;
  let suppressEventClick = false;
  let suppressDateClick = false;

  // Long-press state
  let longPressTimer = null;
  let longPressStart = null;
  let longPressPayload = null;
  let longPressHandled = false;

  // ─── Context menu ───
  const contextMenu = document.createElement('div');
  contextMenu.className = 'task-context-menu';
  contextMenu.id = 'taskContextMenu';
  contextMenu.innerHTML = '<div class="task-context-menu-items"></div>';
  document.body.appendChild(contextMenu);
  const contextMenuItemsEl = contextMenu.querySelector('.task-context-menu-items');

  function formatLocalDate(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function normalizeIsoDate(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return '';
    if (value.includes('T')) return value.split('T', 1)[0];
    return value;
  }

  function notify(type, message, duration) {
    if (typeof window.appNotify === 'function') {
      window.appNotify({ type, message, duration });
      return;
    }
    console.error(message);
  }

  function confirmAction(options) {
    if (typeof window.appConfirm === 'function') {
      return window.appConfirm(options || {});
    }
    console.error((options && options.message) || 'Accion de confirmacion no disponible.');
    return Promise.resolve(false);
  }

  function applyMobileViewButtons() {
    const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    const iconOnly = window.innerWidth <= ICON_ONLY_BREAKPOINT;

    VIEW_BUTTON_CONFIG.forEach(cfg => {
      const btn = calEl.querySelector(cfg.selector);
      if (!btn) return;

      if (!btn.dataset.defaultLabel) {
        btn.dataset.defaultLabel = (btn.textContent || '').trim() || cfg.compactLabel;
      }

      if (!isMobile) {
        btn.classList.remove('fc-view-with-icon', 'fc-view-icon-only');
        btn.textContent = btn.dataset.defaultLabel;
        btn.removeAttribute('aria-label');
        btn.removeAttribute('title');
        return;
      }

      const labelHtml = iconOnly ? '' : `<span class="fc-view-btn-label">${cfg.compactLabel}</span>`;
      btn.classList.add('fc-view-with-icon');
      btn.classList.toggle('fc-view-icon-only', iconOnly);
      btn.innerHTML = `<i class="fa-solid ${cfg.icon}" aria-hidden="true"></i>${labelHtml}`;
      btn.setAttribute('aria-label', cfg.ariaLabel);
      btn.setAttribute('title', cfg.ariaLabel);
    });
  }

  function loadCopiedTask() {
    try {
      const raw = localStorage.getItem(COPY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.title || !parsed.assignee_id) return;
      copiedTask = parsed;
    } catch {
      copiedTask = null;
    }
  }

  function saveCopiedTask(taskData) {
    copiedTask = {
      title: (taskData.title || '').trim(),
      client: (taskData.client || '').trim(),
      description: (taskData.description || '').trim(),
      assignee_id: parseInt(taskData.assignee_id, 10),
      status: taskData.status || 'Pendiente',
    };
    localStorage.setItem(COPY_STORAGE_KEY, JSON.stringify(copiedTask));
  }

  function hideContextMenu() {
    contextMenu.classList.remove('open');
    contextMenu.style.visibility = 'hidden';
    contextMenuItemsEl.innerHTML = '';
  }

  function openContextMenu(clientX, clientY, items) {
    contextMenuItemsEl.innerHTML = '';

    items.forEach(item => {
      if (item.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'task-context-menu-separator';
        contextMenuItemsEl.appendChild(sep);
        return;
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'task-context-menu-item';
      if (item.danger) btn.classList.add('danger');
      if (item.disabled) btn.classList.add('disabled');

      btn.innerHTML = `<i class="fa-solid ${item.icon}"></i><span>${item.label}</span>`;

      if (!item.disabled) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          hideContextMenu();
          item.action();
        });
      }

      contextMenuItemsEl.appendChild(btn);
    });

    contextMenu.classList.add('open');
    contextMenu.style.visibility = 'hidden';

    const margin = 8;
    const menuRect = contextMenu.getBoundingClientRect();
    let left = clientX;
    let top = clientY;

    if (left + menuRect.width > window.innerWidth - margin) {
      left = window.innerWidth - menuRect.width - margin;
    }
    if (top + menuRect.height > window.innerHeight - margin) {
      top = window.innerHeight - menuRect.height - margin;
    }

    if (left < margin) left = margin;
    if (top < margin) top = margin;

    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
    contextMenu.style.visibility = 'visible';
  }

  function suppressCalendarClicks() {
    suppressEventClick = true;
    suppressDateClick = true;
    setTimeout(() => {
      suppressEventClick = false;
      suppressDateClick = false;
    }, 350);
  }

  function getDateFromTarget(target) {
    const dateNode = target.closest('[data-date]');
    if (!dateNode || !calEl.contains(dateNode)) return '';
    return dateNode.getAttribute('data-date') || '';
  }

  function getTaskDataFromElement(eventEl) {
    const taskId = eventEl.dataset.taskId;
    if (!taskId || !calendar) return null;
    const eventApi = calendar.getEventById(taskId);
    if (!eventApi) return null;

    return {
      id: parseInt(eventApi.id, 10),
      ...eventApi.extendedProps,
      title: eventApi.title,
      due_date: formatLocalDate(eventApi.start),
    };
  }

  function updateTask(taskId, payload, revertFn, options) {
    const opts = options || {};
    return fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async r => ({ ok: r.ok, data: await r.json() }))
      .then(({ ok, data }) => {
        if (!ok || !data.success) {
          if (revertFn) revertFn();
          throw new Error(data.error || 'No se pudo actualizar la tarea.');
        }
        calendar.refetchEvents();
        if (opts.successMessage) {
          notify('success', opts.successMessage);
        }
        return data;
      })
      .catch(err => {
        if (revertFn) revertFn();
        if (!opts.silent) {
          notify('error', err.message || 'Error de conexion.');
        }
        throw err;
      });
  }

  function deleteTaskById(taskId) {
    confirmAction({
      title: 'Eliminar tarea',
      message: 'Esta acción no se puede deshacer. ¿Deseas continuar?',
      confirmText: 'Eliminar',
      danger: true,
    }).then(confirmed => {
      if (!confirmed) return;

      fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            closeModal();
            calendar.refetchEvents();
            notify('success', 'Tarea eliminada correctamente.');
            return;
          }
          notify('error', data.error || 'Error al eliminar.');
        })
        .catch(() => notify('error', 'Error de conexion.'));
    });
  }

  function deleteTasksForDate(dateStr) {
    confirmAction({
      title: 'Borrar tareas del día',
      message: `Se eliminarán todas las tareas del ${dateStr}. Esta acción no se puede deshacer.`,
      confirmText: 'Borrar todo',
      danger: true,
    }).then(confirmed => {
      if (!confirmed) return;

      fetch(`/api/tasks/day/${encodeURIComponent(dateStr)}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(data => {
          if (!data.success) {
            notify('error', data.error || 'No se pudieron eliminar las tareas del dia.');
            return;
          }
          calendar.refetchEvents();
          notify('success', `Se eliminaron ${data.deleted || 0} tarea(s) del dia.`);
        })
        .catch(() => notify('error', 'Error de conexion.'));
    });
  }

  function createTaskFromClipboard(dateStr) {
    if (!copiedTask) return;
    if (!copiedTask.assignee_id) {
      notify('warning', 'La tarea copiada no tiene un responsable valido.');
      return;
    }

    const payload = {
      title: copiedTask.title,
      client: copiedTask.client || '',
      description: copiedTask.description || '',
      assignee_id: parseInt(copiedTask.assignee_id, 10),
      due_date: dateStr,
      status: copiedTask.status || 'Pendiente',
      is_recurrent: false,
      recurrence_type: '',
      recurrence_end: '',
    };

    fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.success) {
          notify('error', data.error || 'No se pudo pegar la tarea.');
          return;
        }

        const createdTask = Array.isArray(data.tasks) ? data.tasks[0] : null;
        if (createdTask && copiedTask.status && copiedTask.status !== 'Pendiente') {
          return updateTask(
            createdTask.id,
            { status: copiedTask.status },
            null,
            { silent: true }
          ).catch(() => {
            notify('warning', 'Tarea pegada, pero no se pudo conservar el estado.');
            return null;
          });
        }

        calendar.refetchEvents();
        loadClients();
        notify('success', 'Tarea pegada correctamente.');
        return null;
      })
      .then(() => {
        calendar.refetchEvents();
        loadClients();
      })
      .catch(() => notify('error', 'Error de conexion.'));
  }

  function openTaskContextMenu(x, y, taskData) {
    const isCompleted = taskData.status === 'Completado';

    openContextMenu(x, y, [
      {
        label: 'Editar',
        icon: 'fa-pen',
        action: () => openModal(true, taskData),
      },
      {
        label: 'Marcar como completado',
        icon: 'fa-circle-check',
        disabled: isCompleted,
        action: () => updateTask(
          taskData.id,
          { status: 'Completado' },
          null,
          { successMessage: 'Tarea marcada como completada.' }
        ),
      },
      {
        label: 'Copiar',
        icon: 'fa-copy',
        action: () => {
          saveCopiedTask(taskData);
          notify('success', 'Tarea copiada.');
        },
      },
      { type: 'separator' },
      {
        label: 'Eliminar',
        icon: 'fa-trash',
        danger: true,
        action: () => deleteTaskById(taskData.id),
      },
    ]);
  }

  function openDayContextMenu(x, y, dateStr) {
    openContextMenu(x, y, [
      {
        label: 'Agregar tarea',
        icon: 'fa-plus',
        action: () => {
          openModal(false);
          fDueDate.value = dateStr;
        },
      },
      {
        label: 'Pegar tarea copiada',
        icon: 'fa-paste',
        disabled: !copiedTask,
        action: () => createTaskFromClipboard(dateStr),
      },
      { type: 'separator' },
      {
        label: 'Borrar tareas del dia',
        icon: 'fa-trash',
        danger: true,
        action: () => deleteTasksForDate(dateStr),
      },
    ]);
  }

  function clearLongPress() {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressStart = null;
    longPressPayload = null;
  }

  function handleTouchStart(e) {
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    const eventEl = e.target.closest('.fc-event');

    if (eventEl && calEl.contains(eventEl)) {
      const taskData = getTaskDataFromElement(eventEl);
      if (!taskData) return;
      longPressPayload = {
        type: 'task',
        taskData,
        x: touch.clientX,
        y: touch.clientY,
      };
    } else {
      const dateStr = getDateFromTarget(e.target);
      if (!dateStr) return;
      longPressPayload = {
        type: 'day',
        dateStr,
        x: touch.clientX,
        y: touch.clientY,
      };
    }

    longPressHandled = false;
    longPressStart = { x: touch.clientX, y: touch.clientY };

    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      if (!longPressPayload) return;
      longPressHandled = true;
      suppressCalendarClicks();

      if (longPressPayload.type === 'task') {
        openTaskContextMenu(longPressPayload.x, longPressPayload.y, longPressPayload.taskData);
      } else {
        openDayContextMenu(longPressPayload.x, longPressPayload.y, longPressPayload.dateStr);
      }
    }, LONG_PRESS_DELAY);
  }

  function handleTouchMove(e) {
    if (!longPressTimer || !longPressStart || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const dx = touch.clientX - longPressStart.x;
    const dy = touch.clientY - longPressStart.y;

    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_THRESHOLD) {
      clearLongPress();
    }
  }

  function handleTouchEnd(e) {
    if (longPressTimer) clearLongPress();
    if (!longPressHandled) return;

    e.preventDefault();
    longPressHandled = false;
  }

  function wireContextMenuListeners() {
    calEl.addEventListener('contextmenu', function (e) {
      const eventEl = e.target.closest('.fc-event');
      if (eventEl && calEl.contains(eventEl)) {
        const taskData = getTaskDataFromElement(eventEl);
        if (!taskData) return;
        e.preventDefault();
        suppressCalendarClicks();
        openTaskContextMenu(e.clientX, e.clientY, taskData);
        return;
      }

      const dateStr = getDateFromTarget(e.target);
      if (!dateStr) return;
      e.preventDefault();
      suppressCalendarClicks();
      openDayContextMenu(e.clientX, e.clientY, dateStr);
    });

    calEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    calEl.addEventListener('touchmove', handleTouchMove, { passive: true });
    calEl.addEventListener('touchend', handleTouchEnd, { passive: false });
    calEl.addEventListener('touchcancel', function () {
      clearLongPress();
      longPressHandled = false;
    }, { passive: true });

    document.addEventListener('click', function (e) {
      if (!contextMenu.classList.contains('open')) return;
      if (contextMenu.contains(e.target)) return;
      hideContextMenu();
    });

    document.addEventListener('scroll', hideContextMenu, true);
    window.addEventListener('resize', hideContextMenu);
  }

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
    if (!val) {
      acList.classList.remove('visible');
      return;
    }

    const matches = clientCache.filter(c => c.toLowerCase().includes(val));
    if (matches.length === 0) {
      acList.classList.remove('visible');
      return;
    }

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
      fDueDate.value = normalizeIsoDate(taskData.due_date);
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

    hideContextMenu();
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
    if (e.key === 'Escape') hideContextMenu();
  });

  // ─── SAVE (CREATE / UPDATE) ───
  btnSave.addEventListener('click', function () {
    const id = fId.value;
    const payload = {
      title: fTitle.value.trim(),
      client: fClient.value.trim(),
      description: fDesc.value.trim(),
      assignee_id: parseInt(fAssignee.value, 10),
      due_date: normalizeIsoDate(fDueDate.value),
      status: currentStatus,
      is_recurrent: recurrentCb.checked,
      recurrence_type: recurrentCb.checked ? fRecType.value : '',
      recurrence_end: recurrentCb.checked ? fRecEnd.value : '',
    };

    if (!payload.title) {
      fTitle.focus();
      return;
    }
    if (!payload.due_date) {
      fDueDate.focus();
      return;
    }

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
          loadClients();
          notify('success', id ? 'Tarea actualizada.' : 'Tarea creada.');
          return;
        }
        notify('error', data.error || 'Error al guardar la tarea.');
      })
      .catch(() => notify('error', 'Error de conexion.'))
      .finally(() => {
        btnSave.disabled = false;
        btnSave.innerHTML = '<i class="fa-solid fa-check"></i> Guardar';
      });
  });

  // ─── DELETE ───
  btnDelete.addEventListener('click', function () {
    const id = fId.value;
    if (!id) return;
    deleteTaskById(id);
  });

  // ─── FULLCALENDAR INIT ───
  const statusColorMap = {
    Pendiente: { bg: 'var(--c-warning-bg)', border: 'var(--c-warning)', text: 'var(--c-warning)' },
    'En Progreso': { bg: '#dbeafe', border: '#2563eb', text: '#2563eb' },
    Completado: { bg: 'var(--c-success-bg)', border: 'var(--c-success)', text: 'var(--c-success)' },
  };

  calendar = new FullCalendar.Calendar(calEl, {
    initialView: 'dayGridMonth',
    locale: 'es',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,dayGridWeek,listWeek',
    },
    buttonText: {
      today: 'Hoy',
      month: 'Mes',
      week: 'Semana',
      list: 'Lista',
    },
    height: 'auto',
    editable: true,
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
            const colors = statusColorMap[t.status] || statusColorMap.Pendiente;
            const slug = (t.status || 'Pendiente').toLowerCase().replace(/\s+/g, '-');
            return {
              id: String(t.id),
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

    eventDidMount: function (info) {
      info.el.dataset.taskId = String(info.event.id);
    },

    // Click on a date → create task for that day
    dateClick: function (info) {
      if (suppressDateClick) {
        suppressDateClick = false;
        return;
      }
      openModal(false);
      fDueDate.value = info.dateStr;
    },

    // Click on an event → edit
    eventClick: function (info) {
      info.jsEvent.preventDefault();
      if (suppressEventClick) {
        suppressEventClick = false;
        return;
      }
      openModal(true, info.event.extendedProps);
    },

    // Drag-and-drop → update due_date
    eventDrop: function (info) {
      const taskId = info.event.id;
      const newDate = formatLocalDate(info.event.start);

      if (!newDate) {
        info.revert();
        return;
      }

      updateTask(taskId, { due_date: newDate }, info.revert)
        .catch(() => null);
    },

    datesSet: function () {
      applyMobileViewButtons();
    },

    // Responsive views
    windowResize: function () {
      if (window.innerWidth < MOBILE_BREAKPOINT) {
        calendar.changeView('listWeek');
      }
      applyMobileViewButtons();
    },
  });

  calendar.render();
  wireContextMenuListeners();
  loadCopiedTask();
  applyMobileViewButtons();

  // Handle responsive on initial load
  if (window.innerWidth < MOBILE_BREAKPOINT) {
    calendar.changeView('listWeek');
  }
  applyMobileViewButtons();
});

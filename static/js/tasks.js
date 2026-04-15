/* Tasks - FullCalendar + CRUD + UX improvements */

document.addEventListener('DOMContentLoaded', function () {
  const calEl = document.getElementById('tasksCalendar');
  if (!calEl) return;

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
  const recPreview = document.getElementById('recurrencePreview');
  const deleteSeriesWrap = document.getElementById('deleteSeriesWrap');
  const deleteSeriesCb = document.getElementById('taskDeleteSeries');

  const filterStatus = document.getElementById('tasksFilterStatus');
  const filterAssignee = document.getElementById('tasksFilterAssignee');
  const filterClient = document.getElementById('tasksFilterClient');
  const filterArea = document.getElementById('tasksFilterArea');
  const btnClearFilters = document.getElementById('btnClearTaskFilters');

  const fId = document.getElementById('taskId');
  const fTitle = document.getElementById('taskTitle');
  const fClient = document.getElementById('taskClient');
  const fDesc = document.getElementById('taskDesc');
  const fAssignee = document.getElementById('taskAssignee');
  const fDueDate = document.getElementById('taskDueDate');
  const fRecType = document.getElementById('taskRecurrenceType');
  const fRecEnd = document.getElementById('taskRecurrenceEnd');

  const formMessage = document.getElementById('taskFormMessage');
  const fieldErrors = {
    title: document.getElementById('taskTitleError'),
    assignee: document.getElementById('taskAssigneeError'),
    dueDate: document.getElementById('taskDueDateError'),
    recEnd: document.getElementById('taskRecurrenceEndError')
  };

  const acList = document.getElementById('clientAutocomplete');

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
      ariaLabel: 'Vista mes'
    },
    {
      selector: '.fc-dayGridWeek-button',
      icon: 'fa-calendar-week',
      compactLabel: 'Sem',
      ariaLabel: 'Vista semana'
    },
    {
      selector: '.fc-listWeek-button',
      icon: 'fa-list-ul',
      compactLabel: 'Lista',
      ariaLabel: 'Vista lista'
    }
  ];

  let currentStatus = 'Pendiente';
  let calendar;
  let clientCache = [];
  let filterClientTimer = null;
  let copiedTask = null;
  let suppressEventClick = false;
  let suppressDateClick = false;

  let longPressTimer = null;
  let longPressStart = null;
  let longPressPayload = null;
  let longPressHandled = false;

  const statusColorMap = {
    Pendiente: { bg: 'var(--c-warning-bg)', border: 'var(--c-warning)', text: 'var(--c-warning)' },
    'En Progreso': { bg: '#dbeafe', border: '#2563eb', text: '#2563eb' },
    Completado: { bg: 'var(--c-success-bg)', border: 'var(--c-success)', text: 'var(--c-success)' }
  };

  const contextMenu = document.createElement('div');
  contextMenu.className = 'task-context-menu';
  contextMenu.id = 'taskContextMenu';
  contextMenu.innerHTML = '<div class="task-context-menu-items"></div>';
  document.body.appendChild(contextMenu);
  const contextMenuItemsEl = contextMenu.querySelector('.task-context-menu-items');

  function showToast(message, type, action) {
    if (typeof window.appNotify === 'function') {
      window.appNotify({
        type: type || 'info',
        message: message,
        action: action || null
      });
      return;
    }

    if (type === 'error') {
      console.error(message);
    }
  }

  function notify(type, message) {
    showToast(message, type);
  }

  function confirmAction(options) {
    const opts = options || {};
    if (typeof window.appConfirm === 'function') {
      return window.appConfirm(opts);
    }
    console.error('appConfirm no esta disponible para confirmar la accion.');
    return Promise.resolve(false);
  }

  function showFormMessage(message, type) {
    formMessage.className = `task-form-message ${type || 'error'}`;
    formMessage.textContent = message || '';
  }

  function clearFormMessage() {
    formMessage.className = 'task-form-message';
    formMessage.textContent = '';
  }

  function clearFieldErrors() {
    [fTitle, fAssignee, fDueDate, fRecEnd].forEach(function (field) {
      field.classList.remove('field-invalid');
    });
    Object.values(fieldErrors).forEach(function (errorEl) {
      errorEl.textContent = '';
    });
    recPreview.classList.remove('error');
  }

  function setFieldError(field, errorEl, message) {
    field.classList.add('field-invalid');
    errorEl.textContent = message;
  }

  function requestJson(url, options) {
    return fetch(url, options || {}).then(async function (response) {
      const data = await response.json().catch(function () { return {}; });
      if (!response.ok && !data.error) {
        data.error = 'No se pudo completar la solicitud.';
      }
      return data;
    });
  }

  function toDateValue(value) {
    const dateObj = new Date(`${value}T00:00:00`);
    if (Number.isNaN(dateObj.getTime())) return null;
    return dateObj;
  }

  function formatDate(value) {
    const d = toDateValue(value);
    if (!d) return value;
    return d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });
  }

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

  function estimateRecurrenceCount(startStr, recurrenceType, endStr) {
    const start = toDateValue(startStr);
    const end = toDateValue(endStr);
    if (!start || !end) return null;
    if (end < start) return 0;

    let count = 0;
    let current = new Date(start.getTime());
    let guard = 0;

    while (current <= end && guard < 370) {
      count += 1;
      if (recurrenceType === 'Diaria') {
        current.setDate(current.getDate() + 1);
      } else if (recurrenceType === 'Mensual') {
        const prevDay = current.getDate();
        current.setMonth(current.getMonth() + 1, 1);
        const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
        current.setDate(Math.min(prevDay, daysInMonth));
      } else {
        current.setDate(current.getDate() + 7);
      }
      guard += 1;
    }

    return count;
  }

  function updateRecurrencePreview() {
    recPreview.textContent = '';
    recPreview.classList.remove('error');

    if (!recurrentCb.checked) return;
    if (!fDueDate.value || !fRecEnd.value) {
      recPreview.textContent = 'Completa fecha de entrega y fecha final para previsualizar instancias.';
      return;
    }

    const count = estimateRecurrenceCount(fDueDate.value, fRecType.value, fRecEnd.value);
    if (count === 0) {
      recPreview.classList.add('error');
      recPreview.textContent = 'La fecha final debe ser igual o posterior a la fecha de entrega.';
      return;
    }

    if (count > 365) {
      recPreview.classList.add('error');
      recPreview.textContent = 'Esta recurrencia superaria el maximo permitido de 365 tareas.';
      return;
    }

    recPreview.textContent = `Se crearan ${count} instancia(s).`;
  }

  function validatePayload(payload) {
    clearFormMessage();
    clearFieldErrors();

    let firstInvalid = null;

    if (!payload.title) {
      setFieldError(fTitle, fieldErrors.title, 'El titulo es obligatorio.');
      firstInvalid = firstInvalid || fTitle;
    }

    if (!payload.assignee_id || Number.isNaN(payload.assignee_id)) {
      setFieldError(fAssignee, fieldErrors.assignee, 'Debes asignar la tarea a una persona.');
      firstInvalid = firstInvalid || fAssignee;
    }

    if (!payload.due_date) {
      setFieldError(fDueDate, fieldErrors.dueDate, 'La fecha de entrega es obligatoria.');
      firstInvalid = firstInvalid || fDueDate;
    }

    if (payload.is_recurrent) {
      if (!payload.recurrence_end) {
        setFieldError(fRecEnd, fieldErrors.recEnd, 'La fecha final es obligatoria para recurrencia.');
        firstInvalid = firstInvalid || fRecEnd;
      } else if (payload.recurrence_end < payload.due_date) {
        setFieldError(fRecEnd, fieldErrors.recEnd, 'La fecha final no puede ser menor que la fecha de entrega.');
        firstInvalid = firstInvalid || fRecEnd;
      }
    }

    if (firstInvalid) {
      firstInvalid.focus();
      showFormMessage('Corrige los campos marcados para continuar.', 'error');
      return false;
    }

    return true;
  }

  function getCalendarFilters() {
    return {
      status: filterStatus.value,
      assignee_id: filterAssignee.value,
      client: filterClient.value.trim(),
      area: filterArea ? filterArea.value : ''
    };
  }

  function refreshCalendar() {
    if (calendar) calendar.refetchEvents();
  }

  function applyMobileViewButtons() {
    const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    const iconOnly = window.innerWidth <= ICON_ONLY_BREAKPOINT;

    VIEW_BUTTON_CONFIG.forEach(function (cfg) {
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

  function loadClients() {
    requestJson('/api/tasks/clients').then(function (data) {
      if (Array.isArray(data)) {
        clientCache = data;
      }
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
      status: taskData.status || 'Pendiente'
    };
    localStorage.setItem(COPY_STORAGE_KEY, JSON.stringify(copiedTask));
  }

  function renderAutocomplete() {
    const value = fClient.value.trim().toLowerCase();
    acList.innerHTML = '';

    if (!value) {
      acList.classList.remove('visible');
      return;
    }

    const matches = clientCache
      .filter(function (name) { return name.toLowerCase().includes(value); })
      .slice(0, 8);

    if (!matches.length) {
      acList.classList.remove('visible');
      return;
    }

    matches.forEach(function (match) {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = match;
      item.addEventListener('click', function () {
        fClient.value = match;
        acList.classList.remove('visible');
      });
      acList.appendChild(item);
    });

    acList.classList.add('visible');
  }

  function hideContextMenu() {
    contextMenu.classList.remove('open');
    contextMenu.style.visibility = 'hidden';
    contextMenuItemsEl.innerHTML = '';
  }

  function openContextMenu(clientX, clientY, items) {
    contextMenuItemsEl.innerHTML = '';

    items.forEach(function (item) {
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
    setTimeout(function () {
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
      due_date: formatLocalDate(eventApi.start)
    };
  }

  function updateTask(taskId, payload, revertFn, options) {
    const opts = options || {};
    return requestJson(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (data) {
        if (!data.success) {
          if (typeof revertFn === 'function') revertFn();
          throw new Error(data.error || 'No se pudo actualizar la tarea.');
        }

        refreshCalendar();

        if (opts.successMessage) {
          notify('success', opts.successMessage);
        }
        return data;
      })
      .catch(function (err) {
        if (typeof revertFn === 'function') revertFn();
        if (!opts.silent) {
          notify('error', err.message || 'Error de conexion.');
        }
        throw err;
      });
  }

  function deleteTaskById(taskId, options) {
    const opts = options || {};
    const deleteSeries = !!opts.deleteSeries;
    const title = opts.title || 'Eliminar tarea';
    const message = opts.message || (deleteSeries
      ? 'Se eliminara toda la serie recurrente. Esta accion no se puede deshacer. ¿Deseas continuar?'
      : 'Se eliminara solo esta tarea. Esta accion no se puede deshacer. ¿Deseas continuar?');
    const confirmText = opts.confirmText || 'Eliminar';

    confirmAction({
      title: title,
      message: message,
      confirmText: confirmText,
      danger: true
    }).then(function (confirmed) {
      if (!confirmed) return;

      requestJson(`/api/tasks/${taskId}?series=${deleteSeries ? 'true' : 'false'}`, { method: 'DELETE' })
        .then(function (data) {
          if (!data.success) {
            showFormMessage(data.error || 'No se pudo eliminar la tarea.', 'error');
            return;
          }

          closeModal();
          refreshCalendar();
          notify('success', `Tarea eliminada (${data.deleted || 1} registro(s)).`);
        })
        .catch(function () {
          showFormMessage('Error de conexion al eliminar.', 'error');
        });
    });
  }

  function deleteTasksForDate(dateStr) {
    confirmAction({
      title: 'Borrar tareas del dia',
      message: `Se eliminaran todas las tareas del ${dateStr}. Esta accion no se puede deshacer.`,
      confirmText: 'Borrar todo',
      danger: true
    }).then(function (confirmed) {
      if (!confirmed) return;

      requestJson(`/api/tasks/day/${encodeURIComponent(dateStr)}`, { method: 'DELETE' })
        .then(function (data) {
          if (!data.success) {
            notify('error', data.error || 'No se pudieron eliminar las tareas del dia.');
            return;
          }
          refreshCalendar();
          notify('success', `Se eliminaron ${data.deleted || 0} tarea(s) del dia.`);
        })
        .catch(function () {
          notify('error', 'Error de conexion.');
        });
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
      recurrence_end: ''
    };

    requestJson('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (data) {
        if (!data.success) {
          notify('error', data.error || 'No se pudo pegar la tarea.');
          return null;
        }

        const createdTask = Array.isArray(data.tasks) ? data.tasks[0] : null;
        if (createdTask && copiedTask.status && copiedTask.status !== 'Pendiente') {
          return updateTask(createdTask.id, { status: copiedTask.status }, null, { silent: true })
            .catch(function () {
              notify('warning', 'Tarea pegada, pero no se pudo conservar el estado.');
              return null;
            });
        }

        notify('success', 'Tarea pegada correctamente.');
        return null;
      })
      .then(function () {
        refreshCalendar();
        loadClients();
      })
      .catch(function () {
        notify('error', 'Error de conexion.');
      });
  }

  function openTaskContextMenu(x, y, taskData) {
    const isCompleted = taskData.status === 'Completado';

    openContextMenu(x, y, [
      {
        label: 'Editar',
        icon: 'fa-pen',
        action: function () { openModal(true, taskData); }
      },
      {
        label: 'Marcar como completado',
        icon: 'fa-circle-check',
        disabled: isCompleted,
        action: function () {
          updateTask(taskData.id, { status: 'Completado' }, null, {
            successMessage: 'Tarea marcada como completada.'
          });
        }
      },
      {
        label: 'Copiar',
        icon: 'fa-copy',
        action: function () {
          saveCopiedTask(taskData);
          notify('success', 'Tarea copiada.');
        }
      },
      { type: 'separator' },
      {
        label: 'Eliminar',
        icon: 'fa-trash',
        danger: true,
        action: function () { deleteTaskById(taskData.id); }
      }
    ]);
  }

  function openDayContextMenu(x, y, dateStr) {
    openContextMenu(x, y, [
      {
        label: 'Agregar tarea',
        icon: 'fa-plus',
        action: function () {
          openModal(false);
          fDueDate.value = dateStr;
          updateRecurrencePreview();
        }
      },
      {
        label: 'Pegar tarea copiada',
        icon: 'fa-paste',
        disabled: !copiedTask,
        action: function () { createTaskFromClipboard(dateStr); }
      },
      { type: 'separator' },
      {
        label: 'Borrar tareas del dia',
        icon: 'fa-trash',
        danger: true,
        action: function () { deleteTasksForDate(dateStr); }
      }
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
        taskData: taskData,
        x: touch.clientX,
        y: touch.clientY
      };
    } else {
      const dateStr = getDateFromTarget(e.target);
      if (!dateStr) return;
      longPressPayload = {
        type: 'day',
        dateStr: dateStr,
        x: touch.clientX,
        y: touch.clientY
      };
    }

    longPressHandled = false;
    longPressStart = { x: touch.clientX, y: touch.clientY };

    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = setTimeout(function () {
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

  function openModal(editMode, taskData) {
    fId.value = '';
    fTitle.value = '';
    fClient.value = '';
    fDesc.value = '';
    fDueDate.value = '';
    fRecType.value = 'Semanal';
    fRecEnd.value = '';
    recurrentCb.checked = false;
    recFields.classList.remove('visible');
    deleteSeriesCb.checked = false;
    deleteSeriesWrap.style.display = 'none';
    currentStatus = 'Pendiente';

    clearFormMessage();
    clearFieldErrors();
    updateRecurrencePreview();

    document.querySelectorAll('.status-chip').forEach(function (chip) {
      chip.classList.toggle('selected', chip.dataset.status === 'Pendiente');
    });

    if (editMode && taskData) {
      modalTitle.textContent = 'Editar Tarea';
      fId.value = taskData.id;
      fTitle.value = taskData.title || '';
      fClient.value = taskData.client || '';
      fDesc.value = taskData.description || '';
      fAssignee.value = taskData.assignee_id;
      fDueDate.value = normalizeIsoDate(taskData.due_date);
      currentStatus = taskData.status || 'Pendiente';

      document.querySelectorAll('.status-chip').forEach(function (chip) {
        chip.classList.toggle('selected', chip.dataset.status === currentStatus);
      });

      statusGroup.style.display = '';
      btnDelete.style.display = '';

      recurrentCb.checked = false;
      recurrentCb.parentElement.style.display = 'none';
      recFields.classList.remove('visible');

      if (taskData.is_recurrent && !taskData.parent_task_id) {
        deleteSeriesWrap.style.display = '';
      }
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

  document.querySelectorAll('.status-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      document.querySelectorAll('.status-chip').forEach(function (item) {
        item.classList.remove('selected');
      });
      chip.classList.add('selected');
      currentStatus = chip.dataset.status;
    });
  });

  recurrentCb.addEventListener('change', function () {
    recFields.classList.toggle('visible', recurrentCb.checked);
    if (!recurrentCb.checked) {
      fRecEnd.value = '';
      fieldErrors.recEnd.textContent = '';
      fRecEnd.classList.remove('field-invalid');
    }
    updateRecurrencePreview();
  });

  fDueDate.addEventListener('change', updateRecurrencePreview);
  fRecType.addEventListener('change', updateRecurrencePreview);
  fRecEnd.addEventListener('change', updateRecurrencePreview);

  fClient.addEventListener('input', renderAutocomplete);
  fClient.addEventListener('blur', function () {
    setTimeout(function () {
      acList.classList.remove('visible');
    }, 200);
  });

  btnNew.addEventListener('click', function () { openModal(false); });
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);
  overlay.addEventListener('click', function (event) {
    if (event.target === overlay) closeModal();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && overlay.classList.contains('open')) closeModal();
    if (event.key === 'Escape') hideContextMenu();
  });

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
      recurrence_end: recurrentCb.checked ? fRecEnd.value : ''
    };

    if (!validatePayload(payload)) return;

    const url = id ? `/api/tasks/${id}` : '/api/tasks';
    const method = id ? 'PUT' : 'POST';

    btnSave.disabled = true;
    btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

    requestJson(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (data) {
        if (!data.success) {
          showFormMessage(data.error || 'No se pudo guardar la tarea.', 'error');
          return;
        }

        closeModal();
        refreshCalendar();
        loadClients();

        if (id) {
          notify('success', 'Tarea actualizada correctamente.');
        } else {
          const createdCount = data.count || 1;
          notify('success', `Tarea creada (${createdCount} instancia(s)).`);
        }
      })
      .catch(function () {
        showFormMessage('Error de conexion. Intenta nuevamente.', 'error');
      })
      .finally(function () {
        btnSave.disabled = false;
        btnSave.innerHTML = '<i class="fa-solid fa-check"></i> Guardar';
      });
  });

  btnDelete.addEventListener('click', function () {
    const id = fId.value;
    if (!id) return;

    const deleteSeries = deleteSeriesWrap.style.display !== 'none' && deleteSeriesCb.checked;
    deleteTaskById(id, { deleteSeries: deleteSeries });
  });

  [filterStatus, filterAssignee, filterArea].filter(Boolean).forEach(function (el) {
    el.addEventListener('change', refreshCalendar);
  });

  filterClient.addEventListener('input', function () {
    clearTimeout(filterClientTimer);
    filterClientTimer = setTimeout(refreshCalendar, 300);
  });

  btnClearFilters.addEventListener('click', function () {
    filterStatus.value = '';
    filterAssignee.value = '';
    filterClient.value = '';
    if (filterArea) filterArea.value = '';
    refreshCalendar();
  });

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
    editable: true,
    selectable: true,
    dayMaxEvents: 4,
    moreLinkText: 'mas',

    events: function (info, successCallback, failureCallback) {
      const params = new URLSearchParams({
        start: info.startStr,
        end: info.endStr
      });

      const filters = getCalendarFilters();
      if (filters.status) params.set('status', filters.status);
      if (filters.assignee_id) params.set('assignee_id', filters.assignee_id);
      if (filters.client) params.set('client', filters.client);
      if (filters.area) params.set('area', filters.area);

      fetch('/api/tasks?' + params.toString())
        .then(function (response) {
          if (!response.ok) throw new Error('Error al cargar tareas');
          return response.json();
        })
        .then(function (tasks) {
          const events = tasks.map(function (task) {
            const colors = statusColorMap[task.status] || statusColorMap.Pendiente;
            const slug = (task.status || 'Pendiente').toLowerCase().replace(/\s+/g, '-');
            return {
              id: String(task.id),
              title: task.title,
              start: task.due_date,
              allDay: true,
              backgroundColor: colors.bg,
              borderColor: colors.border,
              textColor: colors.text,
              classNames: ['fc-event-task', `status-${slug}`],
              extendedProps: task
            };
          });
          successCallback(events);
        })
        .catch(function (error) {
          failureCallback(error);
          showToast('No se pudieron cargar las tareas del calendario.', 'error');
        });
    },

    eventDidMount: function (info) {
      const task = info.event.extendedProps;
      const lines = [
        task.title,
        `Estado: ${task.status || 'Pendiente'}`,
        task.client ? `Cliente: ${task.client}` : '',
        task.assignee_name ? `Asignado: ${task.assignee_name}` : '',
        task.due_date ? `Entrega: ${formatDate(task.due_date)}` : ''
      ].filter(Boolean);

      info.el.setAttribute('title', lines.join('\n'));
      info.el.setAttribute('aria-label', lines.join('. '));
      info.el.dataset.taskId = String(info.event.id);
    },

    dateClick: function (info) {
      if (suppressDateClick) {
        suppressDateClick = false;
        return;
      }

      openModal(false);
      fDueDate.value = info.dateStr;
      updateRecurrencePreview();
    },

    eventClick: function (info) {
      info.jsEvent.preventDefault();
      if (suppressEventClick) {
        suppressEventClick = false;
        return;
      }
      openModal(true, info.event.extendedProps);
    },

    eventDrop: function (info) {
      const taskId = info.event.id;
      const previousDate = formatLocalDate(info.oldEvent.start) || normalizeIsoDate(info.oldEvent.startStr);
      const nextDate = formatLocalDate(info.event.start) || normalizeIsoDate(info.event.startStr);

      updateTask(taskId, { due_date: nextDate }, info.revert, { silent: true })
        .then(function () {
          showToast(`Tarea movida al ${formatDate(nextDate)}.`, 'success', {
            label: 'Deshacer',
            onClick: function () {
              updateTask(taskId, { due_date: previousDate }, null, { silent: true })
                .then(function () {
                  info.event.setStart(previousDate);
                  showToast('Movimiento revertido.', 'success');
                })
                .catch(function () {
                  refreshCalendar();
                  showToast('Error de conexion al deshacer.', 'error');
                });
            }
          });
        })
        .catch(function () {
          info.revert();
          showToast('Error de conexion al mover la tarea.', 'error');
        });
    },

    datesSet: function () {
      applyMobileViewButtons();
    },

    windowResize: function () {
      if (window.innerWidth < MOBILE_BREAKPOINT) {
        calendar.changeView('listWeek');
      }
      applyMobileViewButtons();
    }
  });

  calendar.render();
  wireContextMenuListeners();
  loadCopiedTask();

  if (window.innerWidth < MOBILE_BREAKPOINT) {
    calendar.changeView('listWeek');
  }

  applyMobileViewButtons();
  loadClients();
});

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
  const bulkActions = document.getElementById('tasksBulkActions');
  const bulkCount = document.getElementById('tasksBulkCount');
  const btnBulkCopy = document.getElementById('btnBulkCopy');
  const btnBulkMove = document.getElementById('btnBulkMove');
  const btnBulkPending = document.getElementById('btnBulkPending');
  const btnBulkProgress = document.getElementById('btnBulkProgress');
  const btnBulkDone = document.getElementById('btnBulkDone');
  const btnBulkDelete = document.getElementById('btnBulkDelete');
  const btnBulkCancel = document.getElementById('btnBulkCancel');
  const monthPicker = document.getElementById('tasksMonthPicker');
  const monthInput = document.getElementById('tasksMonthInput');
  const btnMonthApply = document.getElementById('btnTasksMonthApply');
  const btnMonthClose = document.getElementById('btnTasksMonthClose');
  const movePicker = document.getElementById('tasksMovePicker');
  const moveDateInput = document.getElementById('tasksMoveDateInput');
  const btnMoveApply = document.getElementById('btnTasksMoveApply');
  const btnMoveClose = document.getElementById('btnTasksMoveClose');

  const fId = document.getElementById('taskId');
  const fTitle = document.getElementById('taskTitle');
  const fClient = document.getElementById('taskClient');
  const fDirectorate = document.getElementById('taskDirectorate');
  const fRequestedBy = document.getElementById('taskRequestedBy');
  const fBudgetType = document.getElementById('taskBudgetType');
  const fDesc = document.getElementById('taskDesc');
  const fAssignee = document.getElementById('taskAssignee');
  const fDueDate = document.getElementById('taskDueDate');
  const fStartDate = document.getElementById('taskStartDate');
  const fEndDate = document.getElementById('taskEndDate');
  const fRecType = document.getElementById('taskRecurrenceType');

  const formMessage = document.getElementById('taskFormMessage');
  const fieldErrors = {
    title: document.getElementById('taskTitleError'),
    assignee: document.getElementById('taskAssigneeError'),
    dueDate: document.getElementById('taskDueDateError'),
    endDate: document.getElementById('taskEndDateError')
  };

  const acList = document.getElementById('clientAutocomplete');

  const COPY_STORAGE_KEY = 'tasksClipboard_v2';
  const MOBILE_VIEW_KEY = 'tasksMobileView_v1';
  const DESKTOP_VIEW_KEY = 'tasksDesktopView_v1';
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
  let copiedBatch = null;
  let selectionMode = false;
  let selectedTaskIds = new Set();
  let suppressEventClick = false;
  let suppressDateClick = false;

  let longPressTimer = null;
  let longPressStart = null;
  let longPressPayload = null;
  let longPressHandled = false;
  let moveAnchorDate = '';

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
    [fTitle, fAssignee, fDueDate, fEndDate].forEach(function (field) {
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

  function isMobileViewport() {
    return window.innerWidth < MOBILE_BREAKPOINT;
  }

  function getViewPreferenceKey() {
    return isMobileViewport() ? MOBILE_VIEW_KEY : DESKTOP_VIEW_KEY;
  }

  function getStartOfWeek(dateValue) {
    const dateObj = dateValue instanceof Date ? new Date(dateValue.getTime()) : toDateValue(dateValue);
    if (!dateObj) return null;
    const weekday = dateObj.getDay();
    const delta = weekday === 0 ? -6 : 1 - weekday;
    dateObj.setDate(dateObj.getDate() + delta);
    return dateObj;
  }

  function shiftIsoDate(isoDate, deltaDays) {
    if (!isoDate) return '';
    const d = toDateValue(isoDate);
    if (!d) return '';
    d.setDate(d.getDate() + deltaDays);
    return formatLocalDate(d);
  }

  function dateDiffDays(a, b) {
    const left = toDateValue(a);
    const right = toDateValue(b);
    if (!left || !right) return 0;
    const ms = left.getTime() - right.getTime();
    return Math.round(ms / 86400000);
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
      const day = current.getDay();
      if (day !== 0 && day !== 6) {
        count += 1;
      }
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
    if (!fDueDate.value || !fEndDate.value) {
      recPreview.textContent = 'Completa fecha de entrega y fecha de finalizacion para previsualizar instancias.';
      return;
    }

    const count = estimateRecurrenceCount(fDueDate.value, fRecType.value, fEndDate.value);
    if (count === 0) {
      recPreview.classList.add('error');
      recPreview.textContent = 'No se generan dias laborables con ese rango y frecuencia.';
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

    if (payload.start_date && payload.end_date && payload.end_date < payload.start_date) {
      setFieldError(fEndDate, fieldErrors.endDate, 'La fecha final no puede ser menor que la fecha de inicio.');
      firstInvalid = firstInvalid || fEndDate;
    }

    if (payload.is_recurrent) {
      const dueDateObj = toDateValue(payload.due_date);
      if (dueDateObj && (dueDateObj.getDay() === 0 || dueDateObj.getDay() === 6)) {
        setFieldError(fDueDate, fieldErrors.dueDate, 'Las tareas recurrentes no pueden iniciar en sabado o domingo.');
        firstInvalid = firstInvalid || fDueDate;
      }

      if (!payload.end_date) {
        setFieldError(fEndDate, fieldErrors.endDate, 'La fecha final es obligatoria para recurrencia.');
        firstInvalid = firstInvalid || fEndDate;
      } else if (payload.end_date < payload.due_date) {
        setFieldError(fEndDate, fieldErrors.endDate, 'La fecha final no puede ser menor que la fecha de entrega.');
        firstInvalid = firstInvalid || fEndDate;
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

  function syncMonthInput(dateObj) {
    if (!monthInput || !(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return;
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    monthInput.value = `${year}-${month}`;
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
      if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) return;
      copiedBatch = parsed;
    } catch {
      copiedBatch = null;
    }
  }

  function toClipboardItem(taskData) {
    const dueDate = normalizeIsoDate(taskData.due_date);
    const dueDateObj = toDateValue(dueDate);
    if (!dueDate || !dueDateObj) return null;
    const weekStart = getStartOfWeek(dueDateObj);
    const weekdayOffset = dateDiffDays(dueDate, formatLocalDate(weekStart));
    const startDate = normalizeIsoDate(taskData.start_date);
    const endDate = normalizeIsoDate(taskData.end_date);

    return {
      title: (taskData.title || '').trim(),
      client: (taskData.client || '').trim(),
      directorate: (taskData.directorate || '').trim(),
      requested_by: (taskData.requested_by || '').trim(),
      budget_type: (taskData.budget_type || '').trim(),
      description: (taskData.description || '').trim(),
      assignee_id: parseInt(taskData.assignee_id, 10),
      original_due_date: dueDate,
      weekday_offset: weekdayOffset,
      start_offset: startDate ? dateDiffDays(startDate, dueDate) : null,
      end_offset: endDate ? dateDiffDays(endDate, dueDate) : null
    };
  }

  function saveCopiedBatch(mode, items) {
    if (!Array.isArray(items) || !items.length) return;
    copiedBatch = {
      mode: mode,
      items: items,
      copied_at: Date.now()
    };
    localStorage.setItem(COPY_STORAGE_KEY, JSON.stringify(copiedBatch));
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

  function clampToViewport(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function placeFloatingElement(el, preferredLeft, preferredTop) {
    if (!el) return;

    const margin = 8;
    el.style.left = '0px';
    el.style.top = '0px';
    const rect = el.getBoundingClientRect();

    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const left = clampToViewport(preferredLeft, margin, maxLeft);
    const top = clampToViewport(preferredTop, margin, maxTop);

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function placeMonthPicker(anchorEl) {
    if (!monthPicker || monthPicker.classList.contains('modal-hidden')) return;
    const anchorRect = anchorEl ? anchorEl.getBoundingClientRect() : null;
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const viewportTop = window.visualViewport ? window.visualViewport.offsetTop : 0;
    const preferredLeft = anchorRect ? anchorRect.left : (window.innerWidth / 2) - 120;
    let preferredTop = anchorRect ? anchorRect.bottom + 8 : 72;

    const pickerRect = monthPicker.getBoundingClientRect();
    const estimatedBottom = preferredTop + pickerRect.height;
    const safeBottom = viewportTop + viewportHeight - 8;
    if (estimatedBottom > safeBottom) {
      preferredTop = safeBottom - pickerRect.height;
    }

    monthPicker.style.right = 'auto';
    monthPicker.style.bottom = 'auto';
    placeFloatingElement(monthPicker, preferredLeft, preferredTop);
  }

  function placeMovePicker(anchorEl) {
    if (!movePicker || movePicker.classList.contains('modal-hidden')) return;
    const anchorRect = anchorEl ? anchorEl.getBoundingClientRect() : null;
    const preferredLeft = anchorRect ? anchorRect.left : (window.innerWidth / 2) - 120;
    const preferredTop = anchorRect ? anchorRect.top - 56 : 72;

    movePicker.style.right = 'auto';
    movePicker.style.bottom = 'auto';
    placeFloatingElement(movePicker, preferredLeft, preferredTop);
  }

  function updateBulkActionsPosition() {
    if (!bulkActions) return;

    let keyboardOffset = 0;
    if (window.visualViewport) {
      const occupied = window.innerHeight - (window.visualViewport.height + window.visualViewport.offsetTop);
      keyboardOffset = Math.max(0, occupied);
    }

    const baseBottom = 14;
    bulkActions.style.bottom = `${baseBottom + keyboardOffset}px`;
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

  function updateSelectionUi() {
    const count = selectedTaskIds.size;
    const label = `${count} seleccionada(s)`;
    if (bulkCount) bulkCount.textContent = label;

    [btnBulkCopy, btnBulkMove, btnBulkPending, btnBulkProgress, btnBulkDone, btnBulkDelete].forEach(function (btn) {
      if (btn) btn.disabled = count === 0;
    });

    if (bulkActions) {
      bulkActions.classList.toggle('modal-hidden', !selectionMode);
    }

    calEl.classList.toggle('task-selection-mode', selectionMode);
    updateBulkActionsPosition();
  }

  function setSelectionMode(enabled) {
    selectionMode = !!enabled;
    if (!selectionMode) {
      selectedTaskIds = new Set();
    }
    updateSelectionUi();
    refreshCalendar();
  }

  function toggleTaskSelection(taskId) {
    const parsedId = parseInt(taskId, 10);
    if (!parsedId) return;
    if (selectedTaskIds.has(parsedId)) {
      selectedTaskIds.delete(parsedId);
    } else {
      selectedTaskIds.add(parsedId);
    }
    updateSelectionUi();
    refreshCalendar();
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

  function getAllVisibleTaskData() {
    if (!calendar) return [];
    return calendar.getEvents().map(function (eventApi) {
      return {
        id: parseInt(eventApi.id, 10),
        ...eventApi.extendedProps,
        title: eventApi.title,
        due_date: formatLocalDate(eventApi.start)
      };
    });
  }

  function copyTaskItems(items, mode, options) {
    const opts = options || {};
    const prepared = items
      .map(toClipboardItem)
      .filter(Boolean)
      .filter(function (item) {
        if (!opts.workdaysOnly) return true;
        return item.weekday_offset >= 0 && item.weekday_offset <= 4;
      });

    if (!prepared.length) {
      notify('warning', opts.workdaysOnly ? 'No hay tareas de lunes a viernes para copiar.' : 'No hay tareas para copiar.');
      return;
    }

    saveCopiedBatch(mode || 'selected', prepared);
    notify('success', `Tareas copiadas: ${prepared.length}.`);
  }

  function copySelectedTasks() {
    const selected = getAllVisibleTaskData().filter(function (task) {
      return selectedTaskIds.has(task.id);
    });
    copyTaskItems(selected, 'selected');
  }

  function getVisibleSelectedEvents() {
    if (!calendar) return [];
    const view = calendar.view;
    const start = view && view.activeStart ? view.activeStart.getTime() : Number.NEGATIVE_INFINITY;
    const end = view && view.activeEnd ? view.activeEnd.getTime() : Number.POSITIVE_INFINITY;

    return calendar.getEvents().filter(function (eventApi) {
      const id = parseInt(eventApi.id, 10);
      if (!selectedTaskIds.has(id)) return false;
      const ts = eventApi.start ? eventApi.start.getTime() : 0;
      return ts >= start && ts < end;
    });
  }

  function copyWorkWeek(dateStr) {
    const weekStart = getStartOfWeek(dateStr);
    if (!weekStart) return;
    const weekStartIso = formatLocalDate(weekStart);
    const weekEndIso = shiftIsoDate(weekStartIso, 4);

    const inWeek = getAllVisibleTaskData().filter(function (task) {
      return task.due_date >= weekStartIso && task.due_date <= weekEndIso;
    });

    copyTaskItems(inWeek, 'workweek', { workdaysOnly: true });
  }

  function copyDay(dateStr) {
    const daily = getAllVisibleTaskData().filter(function (task) {
      return task.due_date === dateStr;
    });
    copyTaskItems(daily, 'day');
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

  function bulkUpdateStatus(statusValue) {
    const taskIds = Array.from(selectedTaskIds);
    if (!taskIds.length) return Promise.resolve();

    return requestJson('/api/tasks/bulk-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_ids: taskIds, status: statusValue })
    }).then(function (data) {
      if (!data.success) throw new Error(data.error || 'No se pudo actualizar en lote.');
      notify('success', `Se actualizaron ${data.updated || 0} tarea(s).`);
      setSelectionMode(false);
      refreshCalendar();
    }).catch(function (err) {
      notify('error', err.message || 'Error de conexion.');
    });
  }

  function bulkMoveByDateMap(dateMap) {
    return requestJson('/api/tasks/bulk-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date_map: dateMap })
    }).then(function (data) {
      if (!data.success) throw new Error(data.error || 'No se pudo mover en lote.');
      notify('success', `Se movieron ${data.updated || 0} tarea(s).`);
      refreshCalendar();
      return data;
    });
  }

  function bulkMoveSelectedByDelta(deltaDays) {
    if (!deltaDays) return Promise.resolve();
    const visibleSelected = getVisibleSelectedEvents();
    if (!visibleSelected.length) {
      notify('warning', 'No hay tareas seleccionadas visibles para mover.');
      return Promise.resolve();
    }

    const dateMap = {};
    visibleSelected.forEach(function (eventApi) {
      const currentDate = formatLocalDate(eventApi.start);
      dateMap[eventApi.id] = shiftIsoDate(currentDate, deltaDays);
    });

    return bulkMoveByDateMap(dateMap).catch(function (err) {
      notify('error', err.message || 'Error de conexion.');
    });
  }

  function bulkMoveSelectedToDate() {
    const visibleSelected = getVisibleSelectedEvents();
    if (!visibleSelected.length) {
      notify('warning', 'No hay tareas seleccionadas visibles para mover.');
      return;
    }

    let anchor = visibleSelected[0];
    visibleSelected.forEach(function (eventApi) {
      if (eventApi.start && anchor.start && eventApi.start < anchor.start) {
        anchor = eventApi;
      }
    });

    moveAnchorDate = formatLocalDate(anchor.start);
    if (moveDateInput) moveDateInput.value = moveAnchorDate;
    if (movePicker) {
      movePicker.classList.remove('modal-hidden');
      placeMovePicker(btnBulkMove);
    }
  }

  function bulkDeleteSelected() {
    const taskIds = Array.from(selectedTaskIds);
    if (!taskIds.length) return;

    confirmAction({
      title: 'Eliminar tareas seleccionadas',
      message: `Se eliminaran ${taskIds.length} tareas seleccionadas. Esta accion no se puede deshacer.`,
      confirmText: 'Eliminar',
      danger: true
    }).then(function (confirmed) {
      if (!confirmed) return;
      requestJson('/api/tasks/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_ids: taskIds })
      }).then(function (data) {
        if (!data.success) {
          notify('error', data.error || 'No se pudieron eliminar las tareas.');
          return;
        }
        notify('success', `Se eliminaron ${data.deleted || 0} tarea(s).`);
        setSelectionMode(false);
        refreshCalendar();
      }).catch(function () {
        notify('error', 'Error de conexion.');
      });
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
    if (!copiedBatch || !Array.isArray(copiedBatch.items) || !copiedBatch.items.length) {
      notify('warning', 'No hay tareas copiadas para pegar.');
      return;
    }

    const targetDate = toDateValue(dateStr);
    if (!targetDate) {
      notify('error', 'Fecha de destino inválida.');
      return;
    }

    const isWorkWeekCopy = copiedBatch.mode === 'workweek';
    const targetWeekStart = getStartOfWeek(targetDate);
    const mondayIso = targetWeekStart ? formatLocalDate(targetWeekStart) : '';
    const anchorSourceDate = copiedBatch.items[0] && copiedBatch.items[0].original_due_date
      ? copiedBatch.items[0].original_due_date
      : '';
    const deltaDays = anchorSourceDate ? dateDiffDays(dateStr, anchorSourceDate) : 0;

    const tasks = copiedBatch.items
      .filter(function (item) { return item && item.assignee_id && item.title; })
      .map(function (item) {
        const sourceDueDate = item.original_due_date || anchorSourceDate || dateStr;
        const dueDate = isWorkWeekCopy
          ? shiftIsoDate(mondayIso, item.weekday_offset)
          : shiftIsoDate(sourceDueDate, deltaDays);
        return {
          title: item.title,
          client: item.client || '',
          directorate: item.directorate || '',
          requested_by: item.requested_by || '',
          budget_type: item.budget_type || '',
          description: item.description || '',
          start_date: item.start_offset === null || item.start_offset === undefined ? '' : shiftIsoDate(dueDate, item.start_offset),
          end_date: item.end_offset === null || item.end_offset === undefined ? '' : shiftIsoDate(dueDate, item.end_offset),
          assignee_id: parseInt(item.assignee_id, 10),
          due_date: dueDate,
          status: 'Pendiente',
          is_recurrent: false,
          recurrence_type: '',
          recurrence_end: ''
        };
      });

    if (!tasks.length) {
      notify('warning', 'No hay tareas validas para pegar.');
      return;
    }

    const pasteModeLabel = isWorkWeekCopy ? 'semanal' : 'fecha exacta';

    requestJson('/api/tasks/bulk-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: tasks })
    })
      .then(function (data) {
        if (!data.success) {
          notify('error', data.error || 'No se pudieron pegar las tareas.');
          return null;
        }

        const createdCount = data.created || 0;
        const failedCount = data.failed || 0;
        if (failedCount > 0) {
          notify('warning', `Pegado parcial (${pasteModeLabel}): ${createdCount} creadas, ${failedCount} fallidas.`);
        } else {
          notify('success', `Tareas pegadas (${pasteModeLabel}): ${createdCount}.`);
        }
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
          copyTaskItems([taskData], 'selected');
        }
      },
      {
        label: 'Seleccionar',
        icon: 'fa-check-square',
        action: function () {
          setSelectionMode(true);
          toggleTaskSelection(taskData.id);
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
        label: 'Pegar tareas copiadas',
        icon: 'fa-paste',
        disabled: !copiedBatch || !Array.isArray(copiedBatch.items) || !copiedBatch.items.length,
        action: function () { createTaskFromClipboard(dateStr); }
      },
      {
        label: 'Copiar dia',
        icon: 'fa-calendar-day',
        action: function () { copyDay(dateStr); }
      },
      {
        label: 'Copiar semana (L-V)',
        icon: 'fa-calendar-week',
        action: function () { copyWorkWeek(dateStr); }
      },
      {
        label: 'Seleccionar',
        icon: 'fa-check-square',
        action: function () { setSelectionMode(true); }
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
        if (selectionMode) {
          e.preventDefault();
          toggleTaskSelection(taskData.id);
          return;
        }
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

    document.addEventListener('click', function (e) {
      if (!monthPicker || monthPicker.classList.contains('modal-hidden')) return;
      if (monthPicker.contains(e.target)) return;
      if (e.target && e.target.classList && e.target.classList.contains('fc-toolbar-title')) return;
      monthPicker.classList.add('modal-hidden');
    });

    document.addEventListener('click', function (e) {
      if (!movePicker || movePicker.classList.contains('modal-hidden')) return;
      if (movePicker.contains(e.target)) return;
      if (btnBulkMove && btnBulkMove.contains(e.target)) return;
      movePicker.classList.add('modal-hidden');
    });

    document.addEventListener('scroll', hideContextMenu, true);
    window.addEventListener('resize', hideContextMenu);
    window.addEventListener('resize', function () {
      placeMonthPicker(calEl.querySelector('.fc-toolbar-title'));
      placeMovePicker(btnBulkMove);
      updateBulkActionsPosition();
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () {
        placeMonthPicker(calEl.querySelector('.fc-toolbar-title'));
        placeMovePicker(btnBulkMove);
        updateBulkActionsPosition();
      });
      window.visualViewport.addEventListener('scroll', function () {
        placeMonthPicker(calEl.querySelector('.fc-toolbar-title'));
        placeMovePicker(btnBulkMove);
        updateBulkActionsPosition();
      });
    }
  }

  function openModal(editMode, taskData) {
    fId.value = '';
    fTitle.value = '';
    fClient.value = '';
    fDirectorate.value = '';
    fRequestedBy.value = '';
    fBudgetType.value = '';
    fDesc.value = '';
    fDueDate.value = '';
    fStartDate.value = '';
    fEndDate.value = '';
    fRecType.value = 'Semanal';
    recurrentCb.checked = false;
    recFields.classList.remove('visible');
    deleteSeriesCb.checked = false;
    deleteSeriesWrap.classList.add('modal-hidden');
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
      fDirectorate.value = taskData.directorate || '';
      fRequestedBy.value = taskData.requested_by || '';
      fBudgetType.value = taskData.budget_type || '';
      fDesc.value = taskData.description || '';
      fAssignee.value = taskData.assignee_id;
      fDueDate.value = normalizeIsoDate(taskData.due_date);
      fStartDate.value = normalizeIsoDate(taskData.start_date);
      fEndDate.value = normalizeIsoDate(taskData.end_date);
      currentStatus = taskData.status || 'Pendiente';

      document.querySelectorAll('.status-chip').forEach(function (chip) {
        chip.classList.toggle('selected', chip.dataset.status === currentStatus);
      });

      statusGroup.classList.remove('modal-hidden');
      btnDelete.classList.remove('modal-hidden');

      recurrentCb.checked = false;
      recurrentCb.parentElement.style.display = 'none';
      recFields.classList.remove('visible');

      if (taskData.is_recurrent && !taskData.parent_task_id) {
        deleteSeriesWrap.classList.remove('modal-hidden');
      }
    } else {
      modalTitle.textContent = 'Nueva Tarea';
      statusGroup.classList.remove('modal-hidden');
      btnDelete.classList.add('modal-hidden');
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
    if (!recurrentCb.checked && fieldErrors.endDate) {
      fieldErrors.endDate.textContent = '';
      fEndDate.classList.remove('field-invalid');
    }
    updateRecurrencePreview();
  });

  fDueDate.addEventListener('change', updateRecurrencePreview);
  fRecType.addEventListener('change', updateRecurrencePreview);
  fEndDate.addEventListener('change', updateRecurrencePreview);

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
      directorate: fDirectorate.value.trim(),
      requested_by: fRequestedBy.value.trim(),
      budget_type: fBudgetType.value.trim(),
      description: fDesc.value.trim(),
      assignee_id: parseInt(fAssignee.value, 10),
      due_date: normalizeIsoDate(fDueDate.value),
      start_date: normalizeIsoDate(fStartDate.value),
      end_date: normalizeIsoDate(fEndDate.value),
      status: currentStatus,
      is_recurrent: recurrentCb.checked,
      recurrence_type: recurrentCb.checked ? fRecType.value : '',
      recurrence_end: recurrentCb.checked ? normalizeIsoDate(fEndDate.value) : ''
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

    const deleteSeries = !deleteSeriesWrap.classList.contains('modal-hidden') && deleteSeriesCb.checked;
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

  if (btnBulkCancel) btnBulkCancel.addEventListener('click', function () { setSelectionMode(false); });
  if (btnBulkCopy) btnBulkCopy.addEventListener('click', function () { copySelectedTasks(); setSelectionMode(false); });
  if (btnBulkMove) btnBulkMove.addEventListener('click', bulkMoveSelectedToDate);
  if (btnBulkPending) btnBulkPending.addEventListener('click', function () { bulkUpdateStatus('Pendiente'); });
  if (btnBulkProgress) btnBulkProgress.addEventListener('click', function () { bulkUpdateStatus('En Progreso'); });
  if (btnBulkDone) btnBulkDone.addEventListener('click', function () { bulkUpdateStatus('Completado'); });
  if (btnBulkDelete) btnBulkDelete.addEventListener('click', bulkDeleteSelected);

  if (btnMonthApply && monthInput) {
    btnMonthApply.addEventListener('click', function () {
      if (!monthInput.value) return;
      calendar.gotoDate(`${monthInput.value}-01`);
      if (monthPicker) monthPicker.classList.add('modal-hidden');
    });
  }

  if (btnMonthClose && monthPicker) {
    btnMonthClose.addEventListener('click', function () {
      monthPicker.classList.add('modal-hidden');
    });
  }

  if (btnMoveApply && moveDateInput) {
    btnMoveApply.addEventListener('click', function () {
      const targetDate = (moveDateInput.value || '').trim();
      if (!targetDate || !toDateValue(targetDate)) {
        notify('error', 'Fecha inválida. Usa formato YYYY-MM-DD.');
        return;
      }

      const anchorDate = moveAnchorDate || targetDate;
      const deltaDays = dateDiffDays(targetDate, anchorDate);
      bulkMoveSelectedByDelta(deltaDays);
      if (movePicker) movePicker.classList.add('modal-hidden');
    });
  }

  if (btnMoveClose && movePicker) {
    btnMoveClose.addEventListener('click', function () {
      movePicker.classList.add('modal-hidden');
    });
  }

  const preferredView = localStorage.getItem(getViewPreferenceKey()) || (isMobileViewport() ? 'dayGridWeek' : 'dayGridMonth');

  calendar = new FullCalendar.Calendar(calEl, {
    initialView: preferredView,
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
    eventOrder: function (a, b) {
      const priority = { Pendiente: 1, 'En Progreso': 2, Completado: 3 };
      const p1 = priority[a.extendedProps.status] || 99;
      const p2 = priority[b.extendedProps.status] || 99;
      if (p1 !== p2) return p1 - p2;
      return String(a.title || '').localeCompare(String(b.title || ''), 'es');
    },

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
        task.directorate ? `Director/Gerencia: ${task.directorate}` : '',
        task.requested_by ? `Solicitado por: ${task.requested_by}` : '',
        task.assignee_name ? `Asignado: ${task.assignee_name}` : '',
        task.due_date ? `Entrega: ${formatDate(task.due_date)}` : ''
      ].filter(Boolean);

      info.el.setAttribute('title', lines.join('\n'));
      info.el.setAttribute('aria-label', lines.join('. '));
      info.el.dataset.taskId = String(info.event.id);
      if (!info.el.querySelector('.task-select-checkbox')) {
        const marker = document.createElement('span');
        marker.className = 'task-select-checkbox';
        info.el.appendChild(marker);
      }
      if (selectedTaskIds.has(parseInt(info.event.id, 10))) {
        info.el.classList.add('task-selected');
      }
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
      if (selectionMode) {
        toggleTaskSelection(info.event.id);
        return;
      }
      openModal(true, info.event.extendedProps);
    },

    eventDrop: function (info) {
      const taskId = info.event.id;
      const previousDate = formatLocalDate(info.oldEvent.start) || normalizeIsoDate(info.oldEvent.startStr);
      const nextDate = formatLocalDate(info.event.start) || normalizeIsoDate(info.event.startStr);

      if (selectionMode && isMobileViewport()) {
        info.revert();
        notify('info', 'En móvil usa "Mover" en la barra de selección.');
        return;
      }

      if (selectionMode) {
        if (!selectedTaskIds.has(parseInt(taskId, 10))) {
          info.revert();
          notify('warning', 'Arrastra una tarea seleccionada para mover el grupo visible.');
          return;
        }

        const deltaDays = dateDiffDays(nextDate, previousDate);
        bulkMoveSelectedByDelta(deltaDays)
          .then(function () {
            showToast('Movimiento grupal aplicado.', 'success');
          })
          .catch(function () {
            info.revert();
          });
        return;
      }

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

    datesSet: function (info) {
      applyMobileViewButtons();
      syncMonthInput(info.start || calendar.getDate());
      localStorage.setItem(getViewPreferenceKey(), info.view.type);

      const titleEl = calEl.querySelector('.fc-toolbar-title');
      if (titleEl && !titleEl.dataset.monthPickerBound) {
        titleEl.dataset.monthPickerBound = '1';
        titleEl.style.cursor = 'pointer';
        titleEl.title = 'Seleccionar mes y año';
        titleEl.addEventListener('click', function () {
          if (!monthPicker) return;
          syncMonthInput(calendar.getDate());
          monthPicker.classList.toggle('modal-hidden');
          if (!monthPicker.classList.contains('modal-hidden')) {
            placeMonthPicker(titleEl);
          }
        });
      }

      if (titleEl && monthPicker && !monthPicker.classList.contains('modal-hidden')) {
        placeMonthPicker(titleEl);
      }
      if (movePicker && !movePicker.classList.contains('modal-hidden')) {
        placeMovePicker(btnBulkMove);
      }
    },

    windowResize: function () {
      updateSelectionUi();
      applyMobileViewButtons();
    }
  });

  calendar.render();
  wireContextMenuListeners();
  loadCopiedTask();
  updateSelectionUi();
  updateBulkActionsPosition();
  applyMobileViewButtons();
  syncMonthInput(calendar.getDate());
  loadClients();
});

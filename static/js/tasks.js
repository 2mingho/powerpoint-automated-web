/* Tasks - FullCalendar + CRUD + UX improvements */

document.addEventListener('DOMContentLoaded', function () {
  const calEl = document.getElementById('tasksCalendar');
  if (!calEl) return;

  // Escapes any user-supplied value before it reaches innerHTML.
  // Falls back to a local copy because tasks.js is loaded from the content
  // block, i.e. before main.js defines window.escapeHtml.
  const escapeHtml = window.escapeHtml || function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const overlay = document.getElementById('taskModalOverlay');
  const btnNew = document.getElementById('btnNewTask');
  const btnClose = document.getElementById('taskModalClose');
  const btnCancel = document.getElementById('btnCancelTask');
  const btnSave = document.getElementById('btnSaveTask');
  const btnDelete = document.getElementById('btnDeleteTask');
  const taskModalTabs = document.getElementById('taskModalTabs');
  const taskCommentsCount = document.getElementById('taskCommentsCount');
  const taskCommentsList = document.getElementById('taskCommentsList');
  const taskActivityList = document.getElementById('taskActivityList');
  const taskCommentBody = document.getElementById('taskCommentBody');
  const btnTaskCommentSend = document.getElementById('btnTaskCommentSend');
  const taskWatchersSection = document.getElementById('taskWatchersSection');
  const taskWatchersChips = document.getElementById('taskWatchersChips');
  const taskWatcherUserSelect = document.getElementById('taskWatcherUserSelect');
  const btnAddWatcher = document.getElementById('btnAddWatcher');
  const btnLeaveWatching = document.getElementById('btnLeaveWatching');
  const taskChecklistCount = document.getElementById('taskChecklistCount');
  const taskChecklistInput = document.getElementById('taskChecklistInput');
  const btnChecklistAdd = document.getElementById('btnTaskChecklistAdd');
  const taskChecklistList = document.getElementById('taskChecklistList');
  const modalTitle = document.getElementById('taskModalTitle');
  const statusGroup = document.getElementById('statusGroup');
  const recurrentCb = document.getElementById('taskRecurrent');
  const recFields = document.getElementById('recurrenceFields');
  const recPreview = document.getElementById('recurrencePreview');
  const deleteSeriesWrap = document.getElementById('deleteSeriesWrap');
  const deleteSeriesCb = document.getElementById('taskDeleteSeries');

  const filterStatus = document.getElementById('tasksFilterStatus');
  const filterPriority = document.getElementById('tasksFilterPriority');
  const filterAssignee = document.getElementById('tasksFilterAssignee');
  const filterClient = document.getElementById('tasksFilterClient');
  const filterArea = document.getElementById('tasksFilterArea');
  const tasksSearch = document.getElementById('tasksSearch');
  const tasksSearchResults = document.getElementById('tasksSearchResults');
  const tasksOverdueBadge = document.getElementById('tasksOverdueBadge');
  const btnClearFilters = document.getElementById('btnClearTaskFilters');
  const btnWatchingTasks = document.getElementById('btnWatchingTasks');
  const btnWatchingRefresh = document.getElementById('btnWatchingRefresh');
  const tasksWatchingPanel = document.getElementById('tasksWatchingPanel');
  const tasksWatchingList = document.getElementById('tasksWatchingList');
  const bulkActions = document.getElementById('tasksBulkActions');
  const bulkCount = document.getElementById('tasksBulkCount');
  const btnBulkCopy = document.getElementById('btnBulkCopy');
  const btnBulkMove = document.getElementById('btnBulkMove');
  const btnBulkPending = document.getElementById('btnBulkPending');
  const btnBulkProgress = document.getElementById('btnBulkProgress');
  const btnBulkDone = document.getElementById('btnBulkDone');
  const btnBulkDelete = document.getElementById('btnBulkDelete');
  const btnBulkCancel = document.getElementById('btnBulkCancel');
  const bulkStatusQuick = document.getElementById('bulkStatusQuick');
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
  const fPriority = document.getElementById('taskPriority');
  const fStartDate = document.getElementById('taskStartDate');
  const fEndDate = document.getElementById('taskEndDate');
  const fRecType = document.getElementById('taskRecurrenceType');
  const fTemplateSelect = document.getElementById('taskTemplateSelect');
  const templateSelectGroup = document.getElementById('templateSelectGroup');
  const btnSaveAsTemplate = document.getElementById('btnSaveAsTemplate');

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
  let currentUpdatedAt = '';
  let currentTaskDetail = null;

  const statusColorMap = {
    Pendiente: { bg: 'var(--c-warning-bg)', border: 'var(--c-warning)', text: 'var(--c-warning)' },
    'En Progreso': { bg: '#dbeafe', border: '#2563eb', text: '#2563eb' },
    Bloqueado: { bg: 'var(--c-danger-bg)', border: 'var(--c-danger)', text: 'var(--c-danger)' },
    'En Revisión': { bg: '#eef2ff', border: '#4f46e5', text: '#4f46e5' },
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

  function slugifyToken(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, '-');
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
      priority: filterPriority ? filterPriority.value : '',
      assignee_id: filterAssignee.value,
      client: filterClient.value.trim(),
      area: filterArea ? filterArea.value : ''
    };
  }

  function refreshCalendar() {
    if (calendar) calendar.refetchEvents();
  }

  let searchTimer = null;

  function loadSearchResults(query) {
    if (!tasksSearchResults) return;
    var params = new URLSearchParams(getCalendarFilters());
    params.set('q', query);
    fetch('/api/tasks?' + params.toString())
      .then(function (r) { return r.json(); })
      .then(function (tasks) {
        if (!Array.isArray(tasks)) { tasks = []; }
        var calEl = document.getElementById('tasksCalendar');
        if (tasks.length === 0) {
          tasksSearchResults.innerHTML = '<div class="task-comments-empty">Sin resultados.</div>';
          tasksSearchResults.classList.remove('modal-hidden');
          if (calEl) calEl.style.display = 'none';
          return;
        }
        tasksSearchResults.innerHTML = tasks.map(function (t) {
          var statusDot = '';
          var statusClass = '';
          if (t.status === 'Pendiente') statusClass = 'st-pendiente';
          else if (t.status === 'En Progreso') statusClass = 'st-en-progreso';
          else if (t.status === 'Completado') statusClass = 'st-completado';
          else if (t.status === 'Bloqueado') statusClass = 'st-bloqueado';
          else if (t.status === 'En Revisión') statusClass = 'st-revision';
          return '<div class="task-comment-item" style="cursor:pointer" data-task-id="' + Number(t.id) + '">'
            + '<div class="task-comment-meta"><span class="task-status-dot ' + statusClass + '">' + escapeHtml(t.status) + '</span> · ' + escapeHtml(t.priority) + ' · ' + escapeHtml(t.due_date || '') + '</div>'
            + '<div class="task-comment-body"><strong>' + escapeHtml(t.title || '') + '</strong>' + (t.client ? ' — ' + escapeHtml(t.client) : '') + '</div>'
            + '</div>';
        }).join('');
        tasksSearchResults.classList.remove('modal-hidden');
        if (calEl) calEl.style.display = 'none';
      })
      .catch(function () {});
  }

  function clearSearch() {
    if (tasksSearch) tasksSearch.value = '';
    if (tasksSearchResults) {
      tasksSearchResults.classList.add('modal-hidden');
      tasksSearchResults.innerHTML = '';
    }
    var calEl = document.getElementById('tasksCalendar');
    if (calEl) calEl.style.display = '';
  }

  function loadOverdueCount() {
    if (!tasksOverdueBadge) return;
    var params = new URLSearchParams(getCalendarFilters());
    params.set('overdue', '1');
    params.set('start', '');
    params.set('end', '');
    fetch('/api/tasks?' + params.toString())
      .then(function (r) { return r.json(); })
      .then(function (tasks) {
        var count = Array.isArray(tasks) ? tasks.length : 0;
        tasksOverdueBadge.textContent = count + ' vencida' + (count !== 1 ? 's' : '');
        tasksOverdueBadge.classList.toggle('modal-hidden', count === 0);
      })
      .catch(function () {});
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
      priority: (taskData.priority || 'Media').trim(),
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

    [btnBulkCopy, btnBulkMove, btnBulkPending, btnBulkProgress, btnBulkDone, btnBulkDelete, bulkStatusQuick].forEach(function (btn) {
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
          if (data.task && opts.onConflict) {
            opts.onConflict(data);
            throw new Error('__conflict__');
          }
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
        if (!(opts.skipRevertOnConflict && err && err.message === '__conflict__') && typeof revertFn === 'function') revertFn();
        if (!opts.silent) {
          notify('error', err.message || 'Error de conexion.');
        }
        throw err;
      });
  }

  function applyTaskToModal(taskData) {
    if (!taskData) return;
    currentTaskDetail = taskData;
    fId.value = taskData.id || '';
    fTitle.value = taskData.title || '';
    fClient.value = taskData.client || '';
    fDirectorate.value = taskData.directorate || '';
    fRequestedBy.value = taskData.requested_by || '';
    fBudgetType.value = taskData.budget_type || '';
    fDesc.value = taskData.description || '';
    fAssignee.value = taskData.assignee_id;
    fDueDate.value = normalizeIsoDate(taskData.due_date);
    fPriority.value = taskData.priority || 'Media';
    fStartDate.value = normalizeIsoDate(taskData.start_date);
    fEndDate.value = normalizeIsoDate(taskData.end_date);
    currentStatus = taskData.status || 'Pendiente';
    currentUpdatedAt = taskData.updated_at || '';
    if (taskCommentsCount) taskCommentsCount.textContent = String(taskData.comments_count || 0);
    renderWatchers(taskData);

    document.querySelectorAll('.status-chip').forEach(function (chip) {
      chip.classList.toggle('selected', chip.dataset.status === currentStatus);
    });
    updateRecurrencePreview();
  }

  function setActiveTaskTab(tabName) {
    document.querySelectorAll('.task-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    document.querySelectorAll('.task-tab-panel').forEach(function (panel) {
      panel.classList.remove('active');
    });
    const activePanel = document.getElementById(`taskTab${tabName.charAt(0).toUpperCase()}${tabName.slice(1)}`);
    if (activePanel) activePanel.classList.add('active');
  }

  function renderTaskComments(comments) {
    if (!taskCommentsList) return;
    if (!Array.isArray(comments) || !comments.length) {
      taskCommentsList.innerHTML = '<div class="task-comments-empty">Sin comentarios.</div>';
      return;
    }
    taskCommentsList.innerHTML = comments.map(function (comment) {
      return `<div class="task-comment-item"><div class="task-comment-meta"><strong>${escapeHtml(comment.user_name || 'Usuario')}</strong> · ${escapeHtml(comment.created_at || '')}</div><div class="task-comment-body">${escapeHtml(comment.body || '')}</div></div>`;
    }).join('');
  }

  function renderTaskHistory(items) {
    if (!taskActivityList) return;
    if (!Array.isArray(items) || !items.length) {
      taskActivityList.innerHTML = '<div class="task-comments-empty">Sin actividad.</div>';
      return;
    }
    taskActivityList.innerHTML = items.map(function (item) {
      return `<div class="task-comment-item"><div class="task-comment-meta"><strong>${escapeHtml(item.user_name || 'Sistema')}</strong> · ${escapeHtml(item.timestamp || '')}</div><div class="task-comment-body">${escapeHtml(item.detail || item.action || '')}</div></div>`;
    }).join('');
  }

  function loadTaskComments(taskId) {
    return requestJson(`/api/tasks/${taskId}/comments`).then(function (data) {
      if (!data.success) throw new Error(data.error || 'No se pudieron cargar comentarios.');
      renderTaskComments(data.comments || []);
      if (taskCommentsCount) taskCommentsCount.textContent = String((data.comments || []).length);
      return data;
    });
  }

  function loadTaskHistory(taskId) {
    return requestJson(`/api/tasks/${taskId}/history`).then(function (data) {
      if (!data.success) throw new Error(data.error || 'No se pudo cargar actividad.');
      renderTaskHistory(data.items || []);
      return data;
    });
  }

  function refreshTaskDetail(taskId) {
    return requestJson(`/api/tasks/${taskId}`).then(function (data) {
      if (!data.success || !data.task) throw new Error(data.error || 'No se pudo cargar detalle.');
      applyTaskToModal(data.task);
      return data.task;
    });
  }

  function renderWatchers(taskData) {
    if (!taskWatchersSection || !taskWatchersChips) return;
    const watchers = Array.isArray(taskData && taskData.watchers) ? taskData.watchers : [];
    taskWatchersSection.classList.toggle('modal-hidden', !taskData || !taskData.id);
    taskWatchersChips.innerHTML = watchers.length
      ? watchers.map(function (watcher) {
          const canRemove = !!taskData.can_edit || !!watcher.is_self;
          return `<span class="task-watcher-chip">${escapeHtml(watcher.username)}${watcher.unit ? ` · ${escapeHtml(watcher.unit)}` : ''}${canRemove ? ` <button type="button" class="task-watcher-remove" data-user-id="${Number(watcher.user_id)}">&times;</button>` : ''}</span>`;
        }).join('')
      : '<div class="task-comments-empty">Sin observadores.</div>';
    if (taskWatcherUserSelect) taskWatcherUserSelect.disabled = !taskData.can_edit;
    if (btnAddWatcher) btnAddWatcher.disabled = !taskData.can_edit;
    if (btnLeaveWatching) btnLeaveWatching.classList.toggle('modal-hidden', !(taskData.is_watcher && !taskData.can_edit));
  }

  function renderChecklist(items) {
    if (!taskChecklistList) return;
    if (!Array.isArray(items) || !items.length) {
      taskChecklistList.innerHTML = '<div class="task-comments-empty">Sin ítems.</div>';
      if (taskChecklistCount) taskChecklistCount.textContent = '0';
      return;
    }
    taskChecklistList.innerHTML = items.map(function (item) {
      return '<div class="task-checklist-item' + (item.is_completed ? ' is-completed' : '') + '" data-id="' + Number(item.id) + '">'
        + '<input type="checkbox" class="task-checklist-cb" ' + (item.is_completed ? 'checked' : '') + '>'
        + '<span class="task-checklist-body">' + escapeHtml(item.body || '') + '</span>'
        + '<button type="button" class="task-checklist-delete" title="Eliminar">&times;</button>'
        + '</div>';
    }).join('');
    if (taskChecklistCount) taskChecklistCount.textContent = String(items.length);
  }

  function loadChecklist(taskId) {
    return requestJson('/api/tasks/' + taskId + '/checklist').then(function (data) {
      if (!data.success) throw new Error(data.error || 'No se pudo cargar checklist.');
      renderChecklist(data.items || []);
      return data;
    });
  }

  function loadWatchingTasks() {
    if (!tasksWatchingList) return;
    tasksWatchingList.innerHTML = '<div class="task-comments-empty">Cargando...</div>';
    requestJson('/api/tasks/watching').then(function (data) {
      if (!data.success || !Array.isArray(data.tasks) || !data.tasks.length) {
        tasksWatchingList.innerHTML = '<div class="task-comments-empty">Sin tareas observadas.</div>';
        return;
      }
      tasksWatchingList.innerHTML = data.tasks.map(function (task) {
        return `<button type="button" class="task-watching-item" data-task-id="${Number(task.id)}"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.due_date || '')}</span></button>`;
      }).join('');
    }).catch(function () {
      tasksWatchingList.innerHTML = '<div class="task-comments-empty">No se pudieron cargar.</div>';
    });
  }

  function openTaskFromQueryParam() {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get('task');
    if (!taskId) return;

    requestJson(`/api/tasks/${taskId}`)
      .then(function (data) {
        if (!data.success || !data.task) return;
        openModal(true, data.task);
      })
      .catch(function () {});
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
          priority: item.priority || 'Media',
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
    fPriority.value = 'Media';
    fStartDate.value = '';
    fEndDate.value = '';
    fRecType.value = 'Semanal';
    recurrentCb.checked = false;
    recFields.classList.remove('visible');
    deleteSeriesCb.checked = false;
    deleteSeriesWrap.classList.add('modal-hidden');
    currentStatus = 'Pendiente';
    currentUpdatedAt = '';
    currentTaskDetail = null;
    if (taskCommentBody) taskCommentBody.value = '';
    if (taskCommentsList) taskCommentsList.innerHTML = '<div class="task-comments-empty">Sin comentarios.</div>';
    if (taskActivityList) taskActivityList.innerHTML = '<div class="task-comments-empty">Sin actividad.</div>';
    if (taskCommentsCount) taskCommentsCount.textContent = '0';
    if (taskChecklistList) taskChecklistList.innerHTML = '<div class="task-comments-empty">Sin ítems.</div>';
    if (taskChecklistCount) taskChecklistCount.textContent = '0';
    if (taskChecklistInput) taskChecklistInput.value = '';
    if (taskWatchersChips) taskWatchersChips.innerHTML = '<div class="task-comments-empty">Sin observadores.</div>';
    if (taskWatchersSection) taskWatchersSection.classList.add('modal-hidden');
    if (btnLeaveWatching) btnLeaveWatching.classList.add('modal-hidden');
    setActiveTaskTab('details');

    clearFormMessage();
    clearFieldErrors();
    updateRecurrencePreview();

    document.querySelectorAll('.status-chip').forEach(function (chip) {
      chip.classList.toggle('selected', chip.dataset.status === 'Pendiente');
    });

    if (editMode && taskData) {
      modalTitle.textContent = 'Editar Tarea';
      applyTaskToModal(taskData);
      if (taskModalTabs) taskModalTabs.classList.remove('modal-hidden');
      loadTaskComments(taskData.id).catch(function () {});
      loadTaskHistory(taskData.id).catch(function () {});
      loadChecklist(taskData.id).catch(function () {});

      statusGroup.classList.remove('modal-hidden');
      btnDelete.classList.remove('modal-hidden');
      if (templateSelectGroup) templateSelectGroup.classList.add('modal-hidden');
      if (btnSaveAsTemplate) btnSaveAsTemplate.classList.remove('modal-hidden');

      recurrentCb.checked = false;
      recurrentCb.parentElement.style.display = 'none';
      recFields.classList.remove('visible');

      if (taskData.is_recurrent && !taskData.parent_task_id) {
        deleteSeriesWrap.classList.remove('modal-hidden');
      }
    } else {
      modalTitle.textContent = 'Nueva Tarea';
      if (taskModalTabs) taskModalTabs.classList.add('modal-hidden');
      statusGroup.classList.remove('modal-hidden');
      btnDelete.classList.add('modal-hidden');
      if (templateSelectGroup) templateSelectGroup.classList.remove('modal-hidden');
      if (btnSaveAsTemplate) btnSaveAsTemplate.classList.add('modal-hidden');
      recurrentCb.parentElement.style.display = '';
      loadTemplates();
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

  document.querySelectorAll('.task-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      setActiveTaskTab(tab.dataset.tab);
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

  /* ── Request modal ── */
  const reqModal = document.getElementById('taskRequestModal');
  const reqBtn = document.getElementById('btnRequestTask');
  const reqClose = document.getElementById('taskRequestClose');
  const reqCancel = document.getElementById('taskRequestCancel');
  const reqSend = document.getElementById('btnTaskRequestSend');
  const reqArea = document.getElementById('taskRequestArea');
  const reqTitle = document.getElementById('taskRequestTitle');
  const reqDesc = document.getElementById('taskRequestDesc');
  const reqClient = document.getElementById('taskRequestClient');
  const reqPriority = document.getElementById('taskRequestPriority');
  const reqDueDate = document.getElementById('taskRequestDueDate');
  const reqMessage = document.getElementById('taskRequestMessage');

  function clearReqMessage() { if (reqMessage) reqMessage.textContent = ''; }
  function openReqModal() {
    if (reqModal) reqModal.classList.remove('modal-hidden');
    clearReqMessage();
    if (reqArea) {
      reqArea.innerHTML = '<option value="">Cargando...</option>';
      fetch('/api/areas').then(function (r) { return r.json(); }).then(function (data) {
        if (!data.success || !Array.isArray(data.areas)) { reqArea.innerHTML = '<option value="">Error</option>'; return; }
        reqArea.innerHTML = '<option value="">Selecciona unidad...</option>';
        data.areas.forEach(function (a) { var o = document.createElement('option'); o.value = a.id; o.textContent = a.name; reqArea.appendChild(o); });
      }).catch(function () { reqArea.innerHTML = '<option value="">Error al cargar</option>'; });
    }
    if (reqTitle) reqTitle.value = '';
    if (reqDesc) reqDesc.value = '';
    if (reqClient) reqClient.value = '';
    if (reqPriority) reqPriority.value = 'Media';
    if (reqDueDate) reqDueDate.value = '';
  }
  function closeReqModal() { if (reqModal) reqModal.classList.add('modal-hidden'); }
  function sendRequest() {
    if (!reqArea || !reqTitle) return;
    var areaId = reqArea.value;
    var title = (reqTitle.value || '').trim();
    if (!areaId) { if (reqMessage) reqMessage.textContent = 'Selecciona una unidad destino.'; return; }
    if (!title) { if (reqMessage) reqMessage.textContent = 'El título es obligatorio.'; return; }
    reqSend.disabled = true;
    var payload = {
      title: title,
      to_area_id: Number(areaId),
      description: (reqDesc ? reqDesc.value : '') || undefined,
      client: (reqClient ? reqClient.value : '') || undefined,
      priority: reqPriority ? reqPriority.value : 'Media',
      due_date: reqDueDate ? (reqDueDate.value || undefined) : undefined,
    };
    fetch('/api/task-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (!data.success) {
        if (reqMessage) reqMessage.textContent = data.error || 'Error al enviar solicitud.';
        return;
      }
      closeReqModal();
      notify('success', 'Solicitud enviada.');
    }).catch(function () {
      if (reqMessage) reqMessage.textContent = 'Error de conexión.';
    }).finally(function () { reqSend.disabled = false; });
  }

  /* ── Templates ── */
  function loadTemplates() {
    if (!fTemplateSelect) return;
    fetch('/api/tasks/templates').then(function (r) { return r.json(); }).then(function (data) {
      fTemplateSelect.innerHTML = '<option value="">— Sin plantilla —</option>';
      if (data.success && Array.isArray(data.templates)) {
        data.templates.forEach(function (t) {
          var o = document.createElement('option');
          o.value = t.id;
          o.textContent = t.name;
          o.dataset.payload = JSON.stringify(t.payload || {});
          fTemplateSelect.appendChild(o);
        });
      }
    }).catch(function () {});
  }

  if (fTemplateSelect) {
    fTemplateSelect.addEventListener('change', function () {
      var opt = fTemplateSelect.options[fTemplateSelect.selectedIndex];
      if (!opt || !opt.value) return;
      try {
        var payload = JSON.parse(opt.dataset.payload || '{}');
        if (fTitle) fTitle.value = payload.title || '';
        if (fClient) fClient.value = payload.client || '';
        if (fDesc) fDesc.value = payload.description || '';
        if (fPriority) fPriority.value = payload.priority || 'Media';
      } catch (e) { /* ignore */ }
    });
  }

  if (btnSaveAsTemplate) {
    btnSaveAsTemplate.addEventListener('click', function () {
      var name = prompt('Nombre para la plantilla:');
      if (!name || !name.trim()) return;
      var payload = {
        title: fTitle ? fTitle.value : '',
        description: fDesc ? fDesc.value : '',
        client: fClient ? fClient.value : '',
        priority: fPriority ? fPriority.value : 'Media',
        budget_type: fBudgetType ? fBudgetType.value : '',
        due_offset_days: 7,
        checklist: [],
      };
      // Try to read checklist items from the current task (if loaded)
      var taskId = fId ? fId.value : '';
      if (taskId) {
        fetch('/api/tasks/' + taskId + '/checklist')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.success && Array.isArray(data.items)) {
              payload.checklist = data.items.map(function (it) { return it.body; });
            }
          })
          .catch(function () {})
          .finally(function () {
            saveTemplate(name.trim(), payload);
          });
      } else {
        saveTemplate(name.trim(), payload);
      }
    });
  }

  function saveTemplate(name, payload) {
    fetch('/api/tasks/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, payload: payload })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (!data.success) { notify('error', data.error || 'Error al guardar plantilla.'); return; }
      notify('success', 'Plantilla guardada.');
      loadTemplates();
    }).catch(function () { notify('error', 'Error de conexión.'); });
  }

  if (reqBtn) reqBtn.addEventListener('click', openReqModal);
  if (reqClose) reqClose.addEventListener('click', closeReqModal);
  if (reqCancel) reqCancel.addEventListener('click', closeReqModal);
  if (reqSend) reqSend.addEventListener('click', sendRequest);
  if (reqModal) reqModal.addEventListener('click', function (e) { if (e.target === reqModal) closeReqModal(); });

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
      priority: fPriority.value,
      start_date: normalizeIsoDate(fStartDate.value),
      end_date: normalizeIsoDate(fEndDate.value),
      status: currentStatus,
      expected_updated_at: currentUpdatedAt,
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
          if (data.task) {
            applyTaskToModal(data.task);
            showFormMessage(data.error || 'La tarea cambió en otra sesión.', 'warning');
            notify('warning', data.error || 'La tarea fue modificada por otro usuario.');
            return;
          }
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

  if (btnTaskCommentSend) {
    btnTaskCommentSend.addEventListener('click', function () {
      const taskId = fId.value;
      const body = (taskCommentBody.value || '').trim();
      if (!taskId || !body) return;

      btnTaskCommentSend.disabled = true;
      requestJson(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body })
      }).then(function (data) {
        if (!data.success) {
          notify('error', data.error || 'No se pudo guardar comentario.');
          return;
        }
        taskCommentBody.value = '';
        return Promise.all([refreshTaskDetail(taskId), loadTaskComments(taskId), loadTaskHistory(taskId)]).then(function () {
          setActiveTaskTab('comments');
        });
      }).catch(function () {
        notify('error', 'Error de conexion al comentar.');
      }).finally(function () {
        btnTaskCommentSend.disabled = false;
      });
    });
  }

  if (btnAddWatcher) {
    btnAddWatcher.addEventListener('click', function () {
      const taskId = fId.value;
      const userId = taskWatcherUserSelect ? taskWatcherUserSelect.value : '';
      if (!taskId || !userId) return;
      requestJson(`/api/tasks/${taskId}/watchers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId })
      }).then(function (data) {
        if (!data.success) {
          notify('error', data.error || 'No se pudo agregar observador.');
          return;
        }
        return refreshTaskDetail(taskId).then(function () {
          notify('success', 'Observador agregado.');
        });
      }).catch(function () {
        notify('error', 'Error de conexion al agregar observador.');
      });
    });
  }

  if (taskWatchersChips) {
    taskWatchersChips.addEventListener('click', function (event) {
      const button = event.target.closest('.task-watcher-remove');
      if (!button) return;
      const taskId = fId.value;
      const userId = button.dataset.userId;
      requestJson(`/api/tasks/${taskId}/watchers/${userId}`, { method: 'DELETE' }).then(function (data) {
        if (!data.success) {
          notify('error', data.error || 'No se pudo quitar observador.');
          return;
        }
        return refreshTaskDetail(taskId).then(function () {
          notify('success', 'Observador removido.');
        });
      }).catch(function () {
        notify('error', 'Error de conexion al quitar observador.');
      });
    });
  }

  /* ── Checklist ── */

  if (btnChecklistAdd && taskChecklistInput) {
    function addChecklistItem() {
      const taskId = fId.value;
      const body = (taskChecklistInput.value || '').trim();
      if (!taskId || !body) return;
      btnChecklistAdd.disabled = true;
      requestJson('/api/tasks/' + taskId + '/checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body })
      }).then(function (data) {
        if (!data.success) { notify('error', data.error || 'Error al agregar ítem.'); return; }
        taskChecklistInput.value = '';
        loadChecklist(taskId).catch(function () {});
      }).catch(function () {
        notify('error', 'Error de conexión.');
      }).finally(function () {
        btnChecklistAdd.disabled = false;
      });
    }
    btnChecklistAdd.addEventListener('click', addChecklistItem);
    taskChecklistInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addChecklistItem();
    });
  }

  if (taskChecklistList) {
    taskChecklistList.addEventListener('click', function (event) {
      const taskId = fId.value;
      if (!taskId) return;

      // Toggle checkbox
      const cb = event.target.closest('.task-checklist-cb');
      if (cb) {
        const itemEl = cb.closest('.task-checklist-item');
        if (!itemEl) return;
        const itemId = itemEl.dataset.id;
        const completed = cb.checked;
        requestJson('/api/tasks/' + taskId + '/checklist/' + itemId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_completed: completed })
        }).then(function (data) {
          if (!data.success) { notify('error', data.error || 'Error al actualizar.'); return; }
          loadChecklist(taskId).catch(function () {});
        }).catch(function () {
          notify('error', 'Error de conexión.');
        });
        return;
      }

      // Delete
      const del = event.target.closest('.task-checklist-delete');
      if (del) {
        const itemEl = del.closest('.task-checklist-item');
        if (!itemEl) return;
        const itemId = itemEl.dataset.id;
        requestJson('/api/tasks/' + taskId + '/checklist/' + itemId, {
          method: 'DELETE'
        }).then(function (data) {
          if (!data.success) { notify('error', data.error || 'Error al eliminar.'); return; }
          loadChecklist(taskId).catch(function () {});
        }).catch(function () {
          notify('error', 'Error de conexión.');
        });
      }
    });
  }

  if (btnLeaveWatching) {
    btnLeaveWatching.addEventListener('click', function () {
      const taskId = fId.value;
      const myUserId = currentTaskDetail && currentTaskDetail.current_user_id;
      const watcher = currentTaskDetail && Array.isArray(currentTaskDetail.watchers)
        ? currentTaskDetail.watchers.find(function (item) { return item.is_self; })
        : null;
      const userId = watcher ? watcher.user_id : myUserId;
      if (!taskId || !userId) return;
      requestJson(`/api/tasks/${taskId}/watchers/${userId}`, { method: 'DELETE' }).then(function (data) {
        if (!data.success) {
          notify('error', data.error || 'No se pudo dejar de observar.');
          return;
        }
        closeModal();
        notify('success', 'Ya no observas esta tarea.');
        loadWatchingTasks();
      }).catch(function () {
        notify('error', 'Error de conexion al dejar de observar.');
      });
    });
  }

  if (btnWatchingTasks && tasksWatchingPanel) {
    btnWatchingTasks.addEventListener('click', function () {
      tasksWatchingPanel.classList.toggle('modal-hidden');
      if (!tasksWatchingPanel.classList.contains('modal-hidden')) loadWatchingTasks();
    });
  }

  if (btnWatchingRefresh) {
    btnWatchingRefresh.addEventListener('click', loadWatchingTasks);
  }

  if (tasksWatchingList) {
    tasksWatchingList.addEventListener('click', function (event) {
      const item = event.target.closest('.task-watching-item');
      if (!item) return;
      refreshTaskDetail(item.dataset.taskId).then(function (task) {
        openModal(true, task);
      }).catch(function () {
        notify('error', 'No se pudo abrir tarea observada.');
      });
    });
  }

  [filterStatus, filterPriority, filterAssignee, filterArea].filter(Boolean).forEach(function (el) {
    el.addEventListener('change', function () { refreshCalendar(); loadOverdueCount(); });
  });

  filterClient.addEventListener('input', function () {
    clearTimeout(filterClientTimer);
    filterClientTimer = setTimeout(function () { refreshCalendar(); loadOverdueCount(); }, 300);
  });

  btnClearFilters.addEventListener('click', function () {
    filterStatus.value = '';
    if (filterPriority) filterPriority.value = '';
    filterAssignee.value = '';
    filterClient.value = '';
    if (filterArea) filterArea.value = '';
    clearSearch();
    refreshCalendar();
    loadOverdueCount();
  });

  /* ── Search ── */
  if (tasksSearch) {
    tasksSearch.addEventListener('input', function () {
      if (searchTimer) clearTimeout(searchTimer);
      var q = (tasksSearch.value || '').trim();
      if (q.length < 2) { clearSearch(); loadOverdueCount(); return; }
      searchTimer = setTimeout(function () { loadSearchResults(q); }, 300);
    });
  }

  if (tasksSearchResults) {
    tasksSearchResults.addEventListener('click', function (event) {
      var item = event.target.closest('[data-task-id]');
      if (!item) return;
      var taskId = item.dataset.taskId;
      if (taskId) openModal(true, { id: taskId });
    });
  }

  /* ── Overdue badge ── */
  if (tasksOverdueBadge) {
    tasksOverdueBadge.addEventListener('click', function () {
      if (tasksSearch) tasksSearch.value = '';
      clearSearch();
      if (filterStatus) filterStatus.value = '';
      // Set the calendar to show overdue tasks only — use a special filter
      // In this simple implementation, just apply it as a filter param
      // by setting a custom property that getCalendarFilters will pick up
      applyOverdueFilter();
    });
  }

  var isOverdueFilterActive = false;

  function applyOverdueFilter() {
    isOverdueFilterActive = true;
    refreshCalendar();
  }

  // Patch getCalendarFilters to include overdue param
  var _origGetCalendarFilters = getCalendarFilters;
  getCalendarFilters = function () {
    var filters = _origGetCalendarFilters();
    if (isOverdueFilterActive) filters.overdue = '1';
    return filters;
  };

  // Also patch clearSearch to reset overdue filter
  var _origClearSearch = clearSearch;
  clearSearch = function () {
    isOverdueFilterActive = false;
    _origClearSearch();
  };

  if (btnBulkCancel) btnBulkCancel.addEventListener('click', function () { setSelectionMode(false); });
  if (btnBulkCopy) btnBulkCopy.addEventListener('click', function () { copySelectedTasks(); setSelectionMode(false); });
  if (btnBulkMove) btnBulkMove.addEventListener('click', bulkMoveSelectedToDate);
  if (btnBulkPending) btnBulkPending.addEventListener('click', function () { bulkUpdateStatus('Pendiente'); });
  if (btnBulkProgress) btnBulkProgress.addEventListener('click', function () { bulkUpdateStatus('En Progreso'); });
  if (btnBulkDone) btnBulkDone.addEventListener('click', function () { bulkUpdateStatus('Completado'); });
  if (bulkStatusQuick) bulkStatusQuick.addEventListener('change', function () {
    if (!bulkStatusQuick.value) return;
    bulkUpdateStatus(bulkStatusQuick.value);
    bulkStatusQuick.value = '';
  });
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
    // El paquete index.global de FullCalendar no incluye los locales, asi que
    // locale:'es' solo afecta al formato de fechas: sus textos propios seguian
    // en ingles ("No events to display", "all-day") en mitad de una interfaz
    // en espanol. Se fijan aqui en vez de cargar otro bundle del CDN.
    allDayText: 'Todo el día',
    noEventsText: 'No hay tareas en este rango.',
    moreLinkText: function (n) { return '+' + n + ' más'; },
    weekText: 'Sem',
    // El paquete index.global de FullCalendar no incluye los locales, asi que
    // locale:'es' solo afecta al formato de fechas: sus textos propios seguian
    // en ingles ("No events to display", "all-day") en mitad de una interfaz
    // en espanol. Se fijan aqui en vez de cargar otro bundle del CDN.
    allDayText: 'Todo el día',
    noEventsText: 'No hay tareas en este rango.',
    moreLinkText: function (n) { return '+' + n + ' más'; },
    weekText: 'Sem',
    // El paquete index.global de FullCalendar no incluye los locales, asi que
    // locale:'es' solo afecta al formato de fechas: sus textos propios seguian
    // en ingles ("No events to display", "all-day") en mitad de una interfaz
    // en espanol. Se fijan aqui en vez de cargar otro bundle del CDN.
    allDayText: 'Todo el día',
    noEventsText: 'No hay tareas en este rango.',
    moreLinkText: function (n) { return '+' + n + ' más'; },
    weekText: 'Sem',
    // El paquete index.global de FullCalendar no incluye los locales, asi que
    // locale:'es' solo afecta al formato de fechas: sus textos propios seguian
    // en ingles ("No events to display", "all-day") en mitad de una interfaz
    // en espanol. Se fijan aqui en vez de cargar otro bundle del CDN.
    allDayText: 'Todo el día',
    noEventsText: 'No hay tareas en este rango.',
    moreLinkText: function (n) { return '+' + n + ' más'; },
    weekText: 'Sem',
    height: 'auto',
    editable: true,
    selectable: true,
    dayMaxEvents: 4,
    moreLinkText: 'mas',
    eventOrder: function (a, b) {
      const statusPriority = { Pendiente: 1, 'En Progreso': 2, 'Bloqueado': 3, 'En Revisión': 4, Completado: 5 };
      const taskPriority = { Alta: 1, Media: 2, Baja: 3 };
      const p1 = statusPriority[a.extendedProps.status] || 99;
      const p2 = statusPriority[b.extendedProps.status] || 99;
      if (p1 !== p2) return p1 - p2;
      const pr1 = taskPriority[a.extendedProps.priority] || 99;
      const pr2 = taskPriority[b.extendedProps.priority] || 99;
      if (pr1 !== pr2) return pr1 - pr2;
      return String(a.title || '').localeCompare(String(b.title || ''), 'es');
    },

    events: function (info, successCallback, failureCallback) {
      const params = new URLSearchParams({
        start: info.startStr,
        end: info.endStr
      });

      const filters = getCalendarFilters();
      if (filters.status) params.set('status', filters.status);
      if (filters.priority) params.set('priority', filters.priority);
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
            const statusSlug = slugifyToken(task.status || 'Pendiente');
            const prioritySlug = slugifyToken(task.priority || 'Media');
            return {
              id: String(task.id),
              title: task.title,
              start: task.due_date,
              allDay: true,
              backgroundColor: colors.bg,
              borderColor: colors.border,
              textColor: colors.text,
              classNames: ['fc-event-task', `status-${statusSlug}`, `task-prio-${prioritySlug}`]
                .concat(task.is_overdue ? ['task-overdue'] : []),
              extendedProps: task
            };
          });
          successCallback(events);
          loadOverdueCount();
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
        `Prioridad: ${task.priority || 'Media'}`,
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

      updateTask(taskId, {
        due_date: nextDate,
        expected_updated_at: info.event.extendedProps.updated_at || ''
      }, info.revert, {
        silent: true,
        skipRevertOnConflict: true,
        onConflict: function (data) {
          info.revert();
          notify('warning', data.error || 'La tarea fue modificada por otro usuario.');
        }
      })
        .then(function () {
          if (info.event.extendedProps) {
            info.event.extendedProps.updated_at = new Date().toISOString();
          }
          showToast(`Tarea movida al ${formatDate(nextDate)}.`, 'success', {
            label: 'Deshacer',
            onClick: function () {
              updateTask(taskId, {
                due_date: previousDate,
                expected_updated_at: info.event.extendedProps.updated_at || ''
              }, null, { silent: true })
                .then(function () {
                  info.event.setStart(previousDate);
                  showToast('Movimiento revertido.', 'success');
                })
                .catch(function (err) {
                  if (err && err.message === '__conflict__') {
                    refreshCalendar();
                    return;
                  }
                  refreshCalendar();
                  showToast('Error de conexion al deshacer.', 'error');
                });
            }
          });
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
  openTaskFromQueryParam();
  loadOverdueCount();
});

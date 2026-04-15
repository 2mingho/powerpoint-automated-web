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
  const toastContainer = document.getElementById('taskToastContainer');

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

  let currentStatus = 'Pendiente';
  let calendar;
  let clientCache = [];
  let filterClientTimer = null;

  const statusColorMap = {
    'Pendiente': { bg: 'var(--c-warning-bg)', border: 'var(--c-warning)', text: 'var(--c-warning)' },
    'En Progreso': { bg: '#dbeafe', border: '#2563eb', text: '#2563eb' },
    'Completado': { bg: 'var(--c-success-bg)', border: 'var(--c-success)', text: 'var(--c-success)' }
  };

  function showToast(message, type, action) {
    const toast = document.createElement('div');
    toast.className = `task-toast ${type || 'success'}`;

    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);

    if (action && action.label && typeof action.onClick === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = action.label;
      btn.addEventListener('click', function () {
        action.onClick();
        toast.remove();
      });
      toast.appendChild(btn);
    }

    toastContainer.appendChild(toast);
    setTimeout(function () {
      toast.remove();
    }, action ? 6000 : 3200);
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

  function loadClients() {
    requestJson('/api/tasks/clients').then(function (data) {
      if (Array.isArray(data)) {
        clientCache = data;
      }
    });
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
      fDueDate.value = taskData.due_date || '';
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
  });

  btnSave.addEventListener('click', function () {
    const id = fId.value;
    const payload = {
      title: fTitle.value.trim(),
      client: fClient.value.trim(),
      description: fDesc.value.trim(),
      assignee_id: parseInt(fAssignee.value, 10),
      due_date: fDueDate.value,
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
      method,
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
          showToast('Tarea actualizada correctamente.', 'success');
        } else {
          const createdCount = data.count || 1;
          showToast(`Tarea creada (${createdCount} instancia(s)).`, 'success');
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
    const message = deleteSeries
      ? 'Se eliminara toda la serie recurrente. Esta accion no se puede deshacer. ¿Deseas continuar?'
      : 'Se eliminara solo esta tarea. Esta accion no se puede deshacer. ¿Deseas continuar?';

    if (!window.confirm(message)) return;

    btnDelete.disabled = true;

    requestJson(`/api/tasks/${id}?series=${deleteSeries ? 'true' : 'false'}`, { method: 'DELETE' })
      .then(function (data) {
        if (!data.success) {
          showFormMessage(data.error || 'No se pudo eliminar la tarea.', 'error');
          return;
        }

        closeModal();
        refreshCalendar();
        showToast(`Tarea eliminada (${data.deleted || 1} registro(s)).`, 'success');
      })
      .catch(function () {
        showFormMessage('Error de conexion al eliminar.', 'error');
      })
      .finally(function () {
        btnDelete.disabled = false;
      });
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
            const slug = task.status.toLowerCase().replace(/\s+/g, '-');
            return {
              id: task.id,
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
    },

    dateClick: function (info) {
      openModal(false);
      fDueDate.value = info.dateStr;
      updateRecurrencePreview();
    },

    eventClick: function (info) {
      info.jsEvent.preventDefault();
      openModal(true, info.event.extendedProps);
    },

    eventDrop: function (info) {
      const taskId = info.event.id;
      const previousDate = info.oldEvent.startStr;
      const nextDate = info.event.startStr;

      requestJson(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: nextDate })
      })
        .then(function (data) {
          if (!data.success) {
            info.revert();
            showToast(data.error || 'No se pudo mover la tarea.', 'error');
            return;
          }

          showToast(`Tarea movida al ${formatDate(nextDate)}.`, 'success', {
            label: 'Deshacer',
            onClick: function () {
              requestJson(`/api/tasks/${taskId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ due_date: previousDate })
              }).then(function (revertData) {
                if (!revertData.success) {
                  refreshCalendar();
                  showToast(revertData.error || 'No se pudo revertir el movimiento.', 'error');
                  return;
                }
                info.event.setStart(previousDate);
                showToast('Movimiento revertido.', 'success');
              }).catch(function () {
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

    windowResize: function () {
      if (window.innerWidth < 768) {
        calendar.changeView('listWeek');
      }
    }
  });

  calendar.render();
  if (window.innerWidth < 768) {
    calendar.changeView('listWeek');
  }

  loadClients();
});

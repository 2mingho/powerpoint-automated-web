document.addEventListener('DOMContentLoaded', function () {
  const toggle = document.getElementById('notifToggle');
  const badge = document.getElementById('notifBadge');
  const panel = document.getElementById('notifPanel');
  const list = document.getElementById('notifList');
  const readAllBtn = document.getElementById('notifReadAll');
  const dropdown = document.getElementById('notifDropdown');
  if (!toggle || !badge || !panel || !list || !readAllBtn || !dropdown) return;

  let panelLoaded = false;

  function setBadge(count) {
    const value = Number(count) || 0;
    badge.textContent = String(value);
    badge.classList.toggle('hidden', value <= 0);
  }

  function renderItems(items) {
    if (!Array.isArray(items) || !items.length) {
      list.innerHTML = '<div class="notif-empty">No hay notificaciones.</div>';
      return;
    }

    list.innerHTML = items.map(function (item) {
      const unreadClass = item.is_read ? '' : ' unread';
      const body = item.body ? `<div class="notif-item-body">${item.body}</div>` : '';
      return `
        <button type="button" class="notif-item${unreadClass}" data-id="${item.id}" data-link="${item.link_url || ''}">
          <div class="notif-item-title">${item.title || 'Notificación'}</div>
          ${body}
          <div class="notif-item-time">${item.created_at || ''}</div>
        </button>
      `;
    }).join('');
  }

  function requestJson(url, options) {
    return fetch(url, options || {}).then(async function (response) {
      const data = await response.json().catch(function () { return {}; });
      if (!response.ok && !data.error) data.error = 'No se pudo completar la solicitud.';
      data._ok = response.ok;
      return data;
    });
  }

  function loadBadge() {
    requestJson('/api/notifications?unread_only=1&limit=20').then(function (data) {
      if (!data.success) return;
      setBadge(data.unread_count || 0);
    });
  }

  function loadPanel() {
    list.innerHTML = '<div class="notif-empty">Cargando...</div>';
    requestJson('/api/notifications?limit=20').then(function (data) {
      if (!data.success) {
        list.innerHTML = '<div class="notif-empty">No se pudieron cargar.</div>';
        return;
      }
      setBadge(data.unread_count || 0);
      renderItems(data.items || []);
      panelLoaded = true;
    });
  }

  toggle.addEventListener('click', function (event) {
    event.preventDefault();
    dropdown.classList.toggle('open');
    if (dropdown.classList.contains('open') && !panelLoaded) {
      loadPanel();
    }
  });

  readAllBtn.addEventListener('click', function () {
    requestJson('/api/notifications/read-all', { method: 'POST' }).then(function (data) {
      if (!data.success) return;
      loadPanel();
      setBadge(0);
    });
  });

  list.addEventListener('click', function (event) {
    const item = event.target.closest('.notif-item');
    if (!item) return;
    const notifId = item.dataset.id;
    const link = item.dataset.link;
    requestJson(`/api/notifications/${notifId}/read`, { method: 'POST' }).then(function () {
      if (link) {
        window.location.href = link;
        return;
      }
      loadPanel();
      loadBadge();
    });
  });

  document.addEventListener('click', function (event) {
    if (!dropdown.contains(event.target)) {
      dropdown.classList.remove('open');
    }
  });

  loadBadge();
  window.setInterval(loadBadge, 90000);
});

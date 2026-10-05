document.addEventListener('DOMContentLoaded', function () {
  const toggle = document.getElementById('notifToggle');
  const badge = document.getElementById('notifBadge');
  const panel = document.getElementById('notifPanel');
  const list = document.getElementById('notifList');
  const readAllBtn = document.getElementById('notifReadAll');
  const dropdown = document.getElementById('notifDropdown');
  if (!toggle || !badge || !panel || !list || !readAllBtn || !dropdown) return;

  let panelLoaded = false;

  // Notification titles and bodies carry user-authored task titles and
  // comment text, so they must never reach innerHTML unescaped.
  const escapeHtml = window.escapeHtml || function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

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
      const body = item.body ? `<div class="notif-item-body">${escapeHtml(item.body)}</div>` : '';
      return `
        <button type="button" class="notif-item${unreadClass}" data-id="${Number(item.id)}" data-link="${escapeHtml(item.link_url || '')}">
          <div class="notif-item-title">${escapeHtml(item.title || 'Notificación')}</div>
          ${body}
          <div class="notif-item-time">${escapeHtml(item.created_at || '')}</div>
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
    requestJson('/api/notifications/unread-count').then(function (data) {
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

  // Solo se sondea con la pestana a la vista. Una pestana olvidada en segundo
  // plano consultaba cada 90 s para siempre y no dejaba que la base se
  // suspendiera, que es justo lo que busca el NullPool de app.py. Al volver a
  // la pestana se refresca en el acto, asi que no se pierde nada.
  const BADGE_INTERVAL_MS = 90000;
  let badgeTimer = null;

  function startBadgePolling() {
    if (badgeTimer !== null) return;
    badgeTimer = window.setInterval(loadBadge, BADGE_INTERVAL_MS);
  }

  function stopBadgePolling() {
    if (badgeTimer === null) return;
    window.clearInterval(badgeTimer);
    badgeTimer = null;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopBadgePolling();
    } else {
      loadBadge();
      startBadgePolling();
    }
  });

  if (!document.hidden) {
    loadBadge();
    startBadgePolling();
  }
});

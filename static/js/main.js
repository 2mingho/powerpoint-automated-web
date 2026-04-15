// ─── Global CSRF Token Injection for fetch() ───
// Intercepts all fetch() calls and adds X-CSRFToken header automatically
(function() {
  const _originalFetch = window.fetch;
  window.fetch = function(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      const csrfMeta = document.querySelector('meta[name="csrf-token"]');
      if (csrfMeta) {
        options.headers = options.headers || {};
        // Support both Headers object and plain object
        if (options.headers instanceof Headers) {
          if (!options.headers.has('X-CSRFToken')) {
            options.headers.set('X-CSRFToken', csrfMeta.content);
          }
        } else {
          if (!options.headers['X-CSRFToken']) {
            options.headers['X-CSRFToken'] = csrfMeta.content;
          }
        }
      }
    }
    return _originalFetch.call(this, url, options);
  };
})();

// ─── Theme Toggle ───
const initTheme = () => {
  const savedTheme = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = savedTheme || (prefersDark ? "dark" : "light");

  document.documentElement.setAttribute("data-theme", theme);
  updateThemeIcon(theme);
};

const updateThemeIcon = (theme) => {
  const icon = document.querySelector(".theme-toggle i");
  if (!icon) return;

  if (theme === "dark") {
    icon.classList.replace("fa-moon", "fa-sun");
  } else {
    icon.classList.replace("fa-sun", "fa-moon");
  }
};

const toggleTheme = () => {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const newTheme = currentTheme === "dark" ? "light" : "dark";

  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem("theme", newTheme);
  updateThemeIcon(newTheme);

  // Update Chart.js defaults if Chart is loaded
  if (window.Chart) {
    updateChartDefaults();
  }
};

const updateChartDefaults = () => {
  if (!window.Chart) return;

  const style = getComputedStyle(document.documentElement);
  const textColor = style.getPropertyValue("--c-chart-text").trim();
  const gridColor = style.getPropertyValue("--c-chart-grid").trim();

  Chart.defaults.color = textColor;
  Chart.defaults.scale.grid.color = gridColor;
  Chart.defaults.plugins.legend.labels.color = textColor;
  Chart.defaults.plugins.title.color = textColor;

  // Re-render active charts if any
  Object.values(Chart.instances).forEach((chart) => chart.update());
};

// ─── Global Feedback UI (toasts + confirms) ───
const initAppFeedback = () => {
  if (window.appNotify && window.appConfirm && window.appPrompt) return;

  const toastLayer = document.createElement("div");
  toastLayer.className = "app-toast-layer";
  toastLayer.id = "appToastLayer";
  document.body.appendChild(toastLayer);

  const confirmOverlay = document.createElement("div");
  confirmOverlay.className = "app-confirm-overlay";
  confirmOverlay.id = "appConfirmOverlay";
  confirmOverlay.innerHTML = `
    <div class="app-confirm-card" role="dialog" aria-modal="true" aria-labelledby="appConfirmTitle">
      <div class="app-confirm-header">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h3 id="appConfirmTitle">Confirmar accion</h3>
      </div>
      <p class="app-confirm-message">Deseas continuar?</p>
      <div class="app-confirm-actions">
        <button type="button" class="btn btn-secondary app-confirm-cancel">Cancelar</button>
        <button type="button" class="btn btn-danger app-confirm-ok">Confirmar</button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmOverlay);

  const titleEl = confirmOverlay.querySelector("#appConfirmTitle");
  const messageEl = confirmOverlay.querySelector(".app-confirm-message");
  const cancelBtn = confirmOverlay.querySelector(".app-confirm-cancel");
  const okBtn = confirmOverlay.querySelector(".app-confirm-ok");
  let confirmResolver = null;

  const promptOverlay = document.createElement("div");
  promptOverlay.className = "app-prompt-overlay";
  promptOverlay.id = "appPromptOverlay";
  promptOverlay.innerHTML = `
    <div class="app-prompt-card" role="dialog" aria-modal="true" aria-labelledby="appPromptTitle">
      <div class="app-prompt-header">
        <i class="fa-solid fa-keyboard"></i>
        <h3 id="appPromptTitle">Ingresa un valor</h3>
      </div>
      <p class="app-prompt-message"></p>
      <input type="text" class="form-input app-prompt-input" maxlength="120">
      <div class="app-prompt-actions">
        <button type="button" class="btn btn-secondary app-prompt-cancel">Cancelar</button>
        <button type="button" class="btn btn-primary app-prompt-ok">Aceptar</button>
      </div>
    </div>
  `;
  document.body.appendChild(promptOverlay);

  const promptTitleEl = promptOverlay.querySelector("#appPromptTitle");
  const promptMessageEl = promptOverlay.querySelector(".app-prompt-message");
  const promptInputEl = promptOverlay.querySelector(".app-prompt-input");
  const promptCancelBtn = promptOverlay.querySelector(".app-prompt-cancel");
  const promptOkBtn = promptOverlay.querySelector(".app-prompt-ok");
  let promptResolver = null;

  const closeConfirm = (result) => {
    if (!confirmOverlay.classList.contains("open")) return;
    confirmOverlay.classList.remove("open");
    document.body.classList.remove("app-confirm-open");
    if (confirmResolver) {
      const resolve = confirmResolver;
      confirmResolver = null;
      resolve(result);
    }
  };

  const closePrompt = (value) => {
    if (!promptOverlay.classList.contains("open")) return;
    promptOverlay.classList.remove("open");
    document.body.classList.remove("app-prompt-open");
    if (promptResolver) {
      const resolve = promptResolver;
      promptResolver = null;
      resolve(value);
    }
  };

  window.appNotify = (opts) => {
    const conf = typeof opts === "string" ? { message: opts } : (opts || {});
    const type = conf.type || "info";
    const message = conf.message || "Operacion completada.";
    const duration = conf.duration || 2800;
    const action = conf.action;

    const iconMap = {
      success: "fa-circle-check",
      error: "fa-circle-exclamation",
      warning: "fa-triangle-exclamation",
      info: "fa-circle-info",
    };

    const toast = document.createElement("div");
    toast.className = `app-toast app-toast-${type}`;

    const iconEl = document.createElement("i");
    iconEl.className = `fa-solid ${iconMap[type] || iconMap.info}`;
    const textEl = document.createElement("span");
    textEl.className = "app-toast-text";
    textEl.textContent = message;
    toast.appendChild(iconEl);
    toast.appendChild(textEl);

    if (action && action.label && typeof action.onClick === "function") {
      const actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.className = "app-toast-action";
      actionBtn.textContent = action.label;
      actionBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        action.onClick();
        closeToast();
      });
      toast.appendChild(actionBtn);
    }

    toastLayer.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("show"));

    const closeToast = () => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 180);
    };

    const timer = setTimeout(closeToast, action ? 6000 : duration);
    toast.addEventListener("click", () => {
      clearTimeout(timer);
      closeToast();
    });
  };

  window.appConfirm = (opts) => {
    const conf = opts || {};

    if (confirmResolver) closeConfirm(false);

    titleEl.textContent = conf.title || "Confirmar accion";
    messageEl.textContent = conf.message || "Deseas continuar?";
    cancelBtn.textContent = conf.cancelText || "Cancelar";
    okBtn.textContent = conf.confirmText || "Confirmar";
    okBtn.classList.toggle("btn-danger", conf.danger !== false);
    okBtn.classList.toggle("btn-primary", conf.danger === false);

    confirmOverlay.classList.add("open");
    document.body.classList.add("app-confirm-open");

    return new Promise((resolve) => {
      confirmResolver = resolve;
      okBtn.focus();
    });
  };

  window.appPrompt = (opts) => {
    const conf = opts || {};

    if (promptResolver) closePrompt(null);

    promptTitleEl.textContent = conf.title || "Ingresa un valor";
    promptMessageEl.textContent = conf.message || "Completa el campo para continuar.";
    promptInputEl.placeholder = conf.placeholder || "Escribe aqui...";
    promptInputEl.value = conf.defaultValue || "";
    promptOkBtn.textContent = conf.confirmText || "Aceptar";
    promptCancelBtn.textContent = conf.cancelText || "Cancelar";

    promptOverlay.classList.add("open");
    document.body.classList.add("app-prompt-open");

    return new Promise((resolve) => {
      promptResolver = resolve;
      setTimeout(() => promptInputEl.focus(), 0);
      promptInputEl.select();
    });
  };

  cancelBtn.addEventListener("click", () => closeConfirm(false));
  okBtn.addEventListener("click", () => closeConfirm(true));
  confirmOverlay.addEventListener("click", (e) => {
    if (e.target === confirmOverlay) closeConfirm(false);
  });

  promptCancelBtn.addEventListener("click", () => closePrompt(null));
  promptOkBtn.addEventListener("click", () => {
    const val = (promptInputEl.value || "").trim();
    closePrompt(val || null);
  });
  promptInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = (promptInputEl.value || "").trim();
      closePrompt(val || null);
    }
  });
  promptOverlay.addEventListener("click", (e) => {
    if (e.target === promptOverlay) closePrompt(null);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && confirmOverlay.classList.contains("open")) {
      closeConfirm(false);
    }
    if (e.key === "Escape" && promptOverlay.classList.contains("open")) {
      closePrompt(null);
    }
  });
};

// ─── Document Ready ───
document.addEventListener("DOMContentLoaded", function () {
  // Init Theme
  initTheme();

  // Init global feedback (toasts/confirms)
  initAppFeedback();

  // Initial Chart defaults
  if (window.Chart) {
    updateChartDefaults();
  }

  // Sidebar Toggle
  const toggle = document.getElementById("sidebarToggle");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");

  if (toggle && sidebar) {
    toggle.addEventListener("click", function () {
      sidebar.classList.toggle("open");
      if (overlay) overlay.classList.toggle("show");
    });
  }

  if (overlay) {
    overlay.addEventListener("click", function () {
      if (sidebar) sidebar.classList.remove("open");
      overlay.classList.remove("show");
    });
  }

  // Theme Toggle Button Event
  const themeBtn = document.getElementById("themeToggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", toggleTheme);
  }

  // Auto-dismiss flash messages after 6 seconds
  const flashes = document.querySelectorAll(".flash-container .flash-msg");
  flashes.forEach(function (msg) {
    setTimeout(function () {
      msg.style.opacity = "0";
      msg.style.transform = "translateY(-10px)";
      msg.style.transition = "all 0.3s ease";
      setTimeout(function () {
        msg.remove();
      }, 300);
    }, 6000);
  });
});

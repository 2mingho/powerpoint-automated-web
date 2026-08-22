// ─── Global HTML escaping helper ───
// Canonical escape for any user-supplied value injected via innerHTML.
// Defined on window so every module shares one implementation.
/* ─── ABRIR Y CERRAR MODALES ───
   Habia dos mecanismos compitiendo para lo mismo: la clase .modal-hidden y el
   par ".task-modal-overlay { display:none }" + ".open { display:flex }". Un
   modal marcado con las dos solo se abria si alguien recordaba tocar las dos,
   y varios no lo hacian: quedaban en display:none para siempre. Estas dos
   funciones son ahora la unica forma de abrir y cerrar. */
window.abrirModal = function (elemento) {
  if (!elemento) return;
  elemento.classList.remove("modal-hidden");
  elemento.classList.add("open");
};

window.cerrarModal = function (elemento) {
  if (!elemento) return;
  elemento.classList.remove("open");
  elemento.classList.add("modal-hidden");
};

window.escapeHtml = function (value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

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

/* ─── CONMUTADOR DE ESPACIOS (RED-1) ───
   El servidor ya deja el espacio correcto abierto segun el endpoint, asi que
   esto solo anade el cambio sin recargar y recuerda la eleccion. Si el script
   no llega a cargar, la navegacion sigue siendo la correcta. */
const initSidebarSpaces = () => {
  const nav = document.getElementById("sidebarNav");
  if (!nav) return;

  const botones = nav.querySelectorAll(".sidebar-space-btn");
  if (!botones.length) return;

  const CLAVE = "nl-espacio-sidebar";

  const aplicar = (espacio) => {
    nav.dataset.espacio = espacio;
    botones.forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.espacio === espacio));
    });
  };

  // La pagina actual manda sobre lo recordado: si estas dentro de una
  // herramienta, abrir el sidebar en "Trabajo" solo esconderia donde estas.
  const enPaginaNeutra = nav.querySelector(".sidebar-item.active") === null;
  if (enPaginaNeutra) {
    let recordado = null;
    try {
      recordado = localStorage.getItem(CLAVE);
    } catch (e) {
      recordado = null;
    }
    if (recordado && nav.querySelector('.sidebar-space[data-espacio="' + recordado + '"]')) {
      aplicar(recordado);
    }
  }

  botones.forEach((boton) => {
    boton.addEventListener("click", () => {
      const espacio = boton.dataset.espacio;
      aplicar(espacio);
      try {
        localStorage.setItem(CLAVE, espacio);
      } catch (e) {
        /* modo privado: el conmutador sigue funcionando, solo no recuerda */
      }
    });
  });
};


/* ─── PALETA DE COMANDOS (RED-6) ───
   Una sola tecla que sirve en toda la aplicacion: buscar una tarea, crear
   una, saltar a una herramienta o abrir el dashboard. Sustituye a aprenderse
   donde vive cada cosa. */
const initCommandPalette = () => {
  const overlay = document.getElementById("cmdkOverlay");
  const input = document.getElementById("cmdkInput");
  const results = document.getElementById("cmdkResults");
  if (!overlay || !input || !results) return;

  let comandos = [];
  let visibles = [];
  let indice = 0;
  let temporizador = null;

  const esc = window.escapeHtml || function (v) { return String(v == null ? "" : v); };

  // Los destinos salen del sidebar ya renderizado: respetan los permisos sin
  // duplicar aqui la logica de has_tool_access.
  const destinosDeNavegacion = () => {
    const vistos = new Set();
    return Array.from(document.querySelectorAll(".sidebar-item[href]"))
      .filter((a) => {
        const href = a.getAttribute("href");
        if (!href || href === "#" || vistos.has(href)) return false;
        // Cerrar sesion no es un destino: un Enter mal dado no debe echarte.
        if (a.closest(".sidebar-footer")) return false;
        vistos.add(href);
        return true;
      })
      .map((a) => ({
        grupo: "Ir a",
        titulo: (a.querySelector("span")?.textContent || a.textContent || "").trim(),
        icono: a.querySelector("i")?.className || "fa-solid fa-arrow-right",
        accion: () => { window.location.href = a.getAttribute("href"); }
      }));
  };

  const acciones = () => {
    const lista = [];
    const btnNueva = document.getElementById("btnNewTask");
    const enlaceTareas = document.querySelector('.sidebar-item[href$="/tasks"]');

    if (btnNueva) {
      lista.push({
        grupo: "Acciones", titulo: "Nueva tarea", icono: "fa-solid fa-plus",
        accion: () => btnNueva.click()
      });
    } else if (enlaceTareas) {
      // Fuera de la pagina de tareas, se llega y se abre alli.
      lista.push({
        grupo: "Acciones", titulo: "Nueva tarea", icono: "fa-solid fa-plus",
        accion: () => { window.location.href = enlaceTareas.getAttribute("href") + "?nueva=1"; }
      });
    }

    const btnTema = document.getElementById("themeToggle");
    if (btnTema) {
      lista.push({
        grupo: "Acciones", titulo: "Cambiar tema claro / oscuro", icono: "fa-solid fa-circle-half-stroke",
        accion: () => btnTema.click()
      });
    }
    return lista;
  };

  const normalizar = (texto) => String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const pintar = () => {
    if (!visibles.length) {
      results.innerHTML = '<p class="cmdk-empty">Nada coincide. Prueba con el nombre de una tarea, un cliente o una herramienta.</p>';
      return;
    }

    let grupoActual = "";
    const filas = visibles.map((cmd, i) => {
      let cabecera = "";
      if (cmd.grupo !== grupoActual) {
        grupoActual = cmd.grupo;
        cabecera = '<p class="cmdk-group">' + esc(cmd.grupo) + "</p>";
      }
      return cabecera
        + '<div class="cmdk-item' + (i === indice ? " is-active" : "") + '" role="option"'
        + ' aria-selected="' + (i === indice ? "true" : "false") + '" data-i="' + i + '">'
        + '<i class="' + esc(cmd.icono) + '" aria-hidden="true"></i>'
        + '<span class="cmdk-item-title">' + esc(cmd.titulo) + "</span>"
        + (cmd.detalle ? '<span class="cmdk-item-meta">' + esc(cmd.detalle) + "</span>" : "")
        + "</div>";
    });

    results.innerHTML = filas.join("");
    const activo = results.querySelector(".cmdk-item.is-active");
    if (activo) activo.scrollIntoView({ block: "nearest" });
  };

  const filtrar = (consulta) => {
    const q = normalizar(consulta);
    const base = comandos.filter((c) => !q || normalizar(c.titulo + " " + (c.detalle || "")).includes(q));
    visibles = base;
    indice = 0;
    pintar();
  };

  // Las tareas se buscan en el servidor; el resto de comandos son locales.
  const buscarTareas = (consulta) => {
    if (consulta.trim().length < 2) return;
    fetch("/api/tasks?q=" + encodeURIComponent(consulta.trim()))
      .then((r) => (r.ok ? r.json() : []))
      .then((tareas) => {
        if (!Array.isArray(tareas) || input.value.trim() !== consulta.trim()) return;
        const deTareas = tareas.slice(0, 6).map((t) => ({
          grupo: "Tareas",
          titulo: t.title || "(sin titulo)",
          detalle: [t.client, t.status].filter(Boolean).join(" · "),
          icono: "fa-regular fa-circle-check",
          accion: () => { window.location.href = "/tasks?task=" + t.id; }
        }));
        visibles = visibles.filter((c) => c.grupo !== "Tareas").concat(deTareas);
        pintar();
      })
      .catch(() => {});
  };

  const abrir = () => {
    comandos = acciones().concat(destinosDeNavegacion());
    overlay.hidden = false;
    input.value = "";
    filtrar("");
    input.focus();
  };

  const cerrar = () => {
    overlay.hidden = true;
    clearTimeout(temporizador);
  };

  const ejecutar = () => {
    const cmd = visibles[indice];
    if (!cmd) return;
    cerrar();
    cmd.accion();
  };

  input.addEventListener("input", () => {
    filtrar(input.value);
    clearTimeout(temporizador);
    temporizador = setTimeout(() => buscarTareas(input.value), 220);
  });

  results.addEventListener("click", (e) => {
    const fila = e.target.closest("[data-i]");
    if (!fila) return;
    indice = Number(fila.dataset.i);
    ejecutar();
  });

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) cerrar();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); indice = Math.min(indice + 1, visibles.length - 1); pintar(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); indice = Math.max(indice - 1, 0); pintar(); }
    else if (e.key === "Enter") { e.preventDefault(); ejecutar(); }
    else if (e.key === "Escape") { e.preventDefault(); cerrar(); }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (overlay.hidden) abrir(); else cerrar();
    }
  });
};

document.addEventListener("DOMContentLoaded", function () {
  // Init Theme
  initTheme();

  // Init global feedback (toasts/confirms)
  initAppFeedback();

  // Initial Chart defaults
  if (window.Chart) {
    updateChartDefaults();
  }

  // Espacios del sidebar
  initSidebarSpaces();

  // Paleta de comandos
  initCommandPalette();

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

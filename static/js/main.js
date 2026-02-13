// ─── Theme Toggle ───
const initTheme = () => {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = savedTheme || (prefersDark ? 'dark' : 'light');
  
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);
};

const updateThemeIcon = (theme) => {
  const icon = document.querySelector('.theme-toggle i');
  if (!icon) return;
  
  if (theme === 'dark') {
    icon.classList.replace('fa-moon', 'fa-sun');
  } else {
    icon.classList.replace('fa-sun', 'fa-moon');
  }
};

const toggleTheme = () => {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  updateThemeIcon(newTheme);
  
  // Update Chart.js defaults if Chart is loaded
  if (window.Chart) {
    updateChartDefaults();
  }
};

const updateChartDefaults = () => {
  if (!window.Chart) return;
  
  const style = getComputedStyle(document.documentElement);
  const textColor = style.getPropertyValue('--c-chart-text').trim();
  const gridColor = style.getPropertyValue('--c-chart-grid').trim();
  
  Chart.defaults.color = textColor;
  Chart.defaults.scale.grid.color = gridColor;
  Chart.defaults.plugins.legend.labels.color = textColor;
  Chart.defaults.plugins.title.color = textColor;
  
  // Re-render active charts if any
  Object.values(Chart.instances).forEach(chart => chart.update());
};

// ─── Document Ready ───
document.addEventListener("DOMContentLoaded", function () {
  // Init Theme
  initTheme();
  
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
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', toggleTheme);
  }

  // Auto-dismiss flash messages after 6 seconds
  const flashes = document.querySelectorAll(".flash-msg");
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

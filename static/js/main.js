// ─── Sidebar Toggle ───
document.addEventListener("DOMContentLoaded", function () {
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

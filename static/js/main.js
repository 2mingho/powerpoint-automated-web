// Espera a que el DOM esté completamente cargado
document.addEventListener("DOMContentLoaded", function () {
    const userMenuToggle = document.querySelector("#userMenuToggle");
    const userMenu = document.querySelector("#userMenu");
  
    if (userMenuToggle && userMenu) {
      userMenuToggle.addEventListener("click", function (e) {
        e.preventDefault();
        userMenu.classList.toggle("visible");
      });
  
      // Cierra el menú si haces clic fuera de él
      document.addEventListener("click", function (e) {
        if (!userMenu.contains(e.target) && !userMenuToggle.contains(e.target)) {
          userMenu.classList.remove("visible");
        }
      });
    }
  });  
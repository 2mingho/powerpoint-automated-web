// Manejo de menú desplegable
document.addEventListener("DOMContentLoaded", function () {
  const userMenuToggle = document.querySelector("#userMenuToggle");
  const userMenu = document.querySelector("#userMenu");

  if (userMenuToggle && userMenu) {
    userMenuToggle.addEventListener("click", function (e) {
      e.preventDefault();
      userMenu.classList.toggle("visible");
    });

    document.addEventListener("click", function (e) {
      if (!userMenu.contains(e.target) && !userMenuToggle.contains(e.target)) {
        userMenu.classList.remove("visible");
      }
    });
  }

  // CSV preview logic
  const fileInput = document.getElementById("csv_file");
  const tableBody = document.querySelector("#preview-table tbody");
  const previewContainer = document.getElementById("preview-container");
  const numRowsSelect = document.getElementById("numRows");

  fileInput.addEventListener("change", function () {
    const file = fileInput.files[0];
    if (file && file.name.endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const lines = e.target.result.split("\n").filter(l => l.trim() !== "");
        const headers = lines[0].split("\t");
        const hitIndex = headers.findIndex(h => h.trim().toLowerCase() === "hit sentence");
        const sentimentIndex = headers.findIndex(h => h.trim().toLowerCase() === "sentiment");

        if (hitIndex === -1 || sentimentIndex === -1) {
          alert("El archivo CSV debe contener las columnas 'Hit Sentence' y 'Sentiment'");
          return;
        }

        const rows = lines.slice(1).map((line) => line.split(","));
        const filteredRows = rows.filter(row => {
          const hit = row[hitIndex] || "";
          return !hit.trim().startsWith("RT ") && !hit.trim().startsWith("QT ");
        });

        // Mostrar tabla por defecto
        previewContainer.style.display = "block";

        function updateTable(limit) {
          tableBody.innerHTML = "";
          filteredRows.slice(0, limit).forEach((row, index) => {
            const tr = document.createElement("tr");

            const tdIndex = document.createElement("td");
            tdIndex.textContent = index + 1;

            const tdCheck = document.createElement("td");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.name = "rowSelect";
            checkbox.value = index;
            tdCheck.appendChild(checkbox);

            const tdHit = document.createElement("td");
            tdHit.textContent = row[hitIndex] || "";

            const tdSent = document.createElement("td");
            tdSent.textContent = row[sentimentIndex] || "";

            tr.appendChild(tdIndex);
            tr.appendChild(tdCheck);
            tr.appendChild(tdHit);
            tr.appendChild(tdSent);
            tableBody.appendChild(tr);
          });
        }

        updateTable(parseInt(numRowsSelect.value));
        numRowsSelect.addEventListener("change", () => {
          updateTable(parseInt(numRowsSelect.value));
        });
      };

      reader.readAsText(file);
    }
  });
});
import { conUsuario } from "@/lib/api";
import { leerFiltros } from "@/lib/tareas/consultas";
import { exportar } from "@/lib/tareas/importar";

export const GET = conUsuario(async (req, u) => {
  const csv = await exportar(u, leerFiltros(new URL(req.url).searchParams));
  const sello = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=tareas_${sello}.csv` },
  });
}, { herramienta: "tasks" });

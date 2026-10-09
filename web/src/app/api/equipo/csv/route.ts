import { conUsuario } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { csvEquipo } from "@/lib/equipo/datos";
import { puertaEquipo } from "@/lib/equipo/puerta";
import { hoyNegocio } from "@/lib/reloj";

/* Exportacion CSV con los mismos filtros que la tabla (api/team/tasks/export-csv). */
export const GET = conUsuario(async (req, u) => {
  const { filtros, alcance } = await puertaEquipo(u, req);
  const csv = await csvEquipo(u, alcance, filtros);
  await registrarActividad(u.id, "task_export_csv", `Exportación CSV del panel de equipo (${csv.split("\r\n").length - 2} filas)`);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tareas_equipo_${hoyNegocio().replace(/-/g, "")}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}, { herramienta: "tasks" });

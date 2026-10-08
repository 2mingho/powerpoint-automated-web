import { conUsuario, ok } from "@/lib/api";
import { DIAS_DE_CERRADAS, leerFiltros, tablero } from "@/lib/tareas/consultas";

export const GET = conUsuario(async (req, u) => {
  const p = new URL(req.url).searchParams;
  const crudo = Number(p.get("cerradas_dias") ?? DIAS_DE_CERRADAS);
  const dias = Number.isFinite(crudo) ? Math.max(0, Math.min(Math.trunc(crudo), 365)) : DIAS_DE_CERRADAS;
  return ok(await tablero(u, leerFiltros(p), dias));
}, { herramienta: "tasks" });

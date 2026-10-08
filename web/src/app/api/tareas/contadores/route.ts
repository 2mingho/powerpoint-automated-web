import { conUsuario, ok } from "@/lib/api";
import { contarSalidas, leerFiltros } from "@/lib/tareas/consultas";

/* Los cuatro contadores de la franja, dentro del alcance visible y del chip elegido. */
export const GET = conUsuario(async (req, u) => ok(await contarSalidas(u, leerFiltros(new URL(req.url).searchParams).alcance)), { herramienta: "tasks" });

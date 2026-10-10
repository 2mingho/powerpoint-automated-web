import { conUsuario, ok } from "@/lib/api";
import { previsualizarPlan } from "@/lib/estudios/servicio";

/* Los pasos y fechas que tendria un estudio con estos datos, sin crear nada. */
export const GET = conUsuario(async (req, u) => {
  const q = new URL(req.url).searchParams;
  return ok({ pasos: await previsualizarPlan(u, { metodo: q.get("metodo"), entrega: q.get("entrega"), responsableId: q.get("responsableId") }) });
}, { herramienta: "tasks" });

import { conUsuario, ok } from "@/lib/api";
import { clientesVisibles, personasDelAmbito } from "@/lib/tareas/personas";

export const GET = conUsuario(async (_req, u) => {
  const [personas, clientes] = await Promise.all([personasDelAmbito(u), clientesVisibles(u)]);
  return ok({ personas, clientes });
}, { herramienta: "tasks" });

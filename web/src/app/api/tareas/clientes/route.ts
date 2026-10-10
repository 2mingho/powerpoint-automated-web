import { conUsuario, ok } from "@/lib/api";
import { clientesVisibles } from "@/lib/tareas/personas";

/* Clientes de las tareas visibles, para autocompletar (api_tasks_clients de Flask). */
export const GET = conUsuario(async (_req, u) => ok({ clientes: await clientesVisibles(u) }), { herramienta: "tasks" });

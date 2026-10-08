import { conUsuario, cuerpo, ok } from "@/lib/api";
import { operacionMasiva } from "@/lib/tareas/mutaciones";

/* { accion: "borrar" | "editar", task_ids, status?, priority?, due_date_map? } */
export const POST = conUsuario(async (req, u) => ok(await operacionMasiva(u, await cuerpo(req))), { herramienta: "tasks" });

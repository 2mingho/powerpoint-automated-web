import { conUsuario, cuerpo, ok } from "@/lib/api";
import { importar } from "@/lib/tareas/importar";

export const POST = conUsuario(async (req, u) => ok(await importar(u, await cuerpo(req))), { herramienta: "tasks" });

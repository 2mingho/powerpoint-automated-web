import { conUsuario, ok } from "@/lib/api";
import { opcionesFormulario } from "@/lib/solicitudes/servicio";

/* Lo que necesita el formulario: unidades a las que puede solicitar (sin las propias) y prioridades. */
export const GET = conUsuario(async (_req, u) => ok(await opcionesFormulario(u)), { herramienta: "tasks" });

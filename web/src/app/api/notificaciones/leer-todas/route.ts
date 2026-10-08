import { conUsuario, ok } from "@/lib/api";
import { marcarTodas } from "@/lib/campana/consultas";

export const POST = conUsuario(async (_req, u) => ok(await marcarTodas(u.id)));

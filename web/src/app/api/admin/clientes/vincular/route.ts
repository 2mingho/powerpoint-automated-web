import { conUsuario, ok } from "@/lib/api";
import { SOLO_ADMIN } from "@/lib/admin/api";
import { vincularPendientes } from "@/lib/clientes/admin";

export const POST = conUsuario(async (_req, u) => ok(await vincularPendientes(u.id)), SOLO_ADMIN);

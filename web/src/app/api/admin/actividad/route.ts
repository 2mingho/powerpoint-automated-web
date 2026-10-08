import { conUsuario, ok } from "@/lib/api";
import { actividad, leerFiltrosActividad } from "@/lib/admin/consultas";
import { SOLO_ADMIN } from "@/lib/admin/api";

export const GET = conUsuario(async (req) => ok(await actividad(leerFiltrosActividad(new URL(req.url).searchParams))), SOLO_ADMIN);

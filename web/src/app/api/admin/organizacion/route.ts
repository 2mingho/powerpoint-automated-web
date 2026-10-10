import { conUsuario, ok } from "@/lib/api";
import { organizacion } from "@/lib/admin/consultas";
import { SOLO_ADMIN } from "@/lib/admin/api";

export const GET = conUsuario(async () => ok(await organizacion()), SOLO_ADMIN);

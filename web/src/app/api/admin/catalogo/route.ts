import { conUsuario, ok } from "@/lib/api";
import { catalogo } from "@/lib/admin/consultas";
import { SOLO_ADMIN } from "@/lib/admin/api";

export const GET = conUsuario(async () => ok(await catalogo()), SOLO_ADMIN);

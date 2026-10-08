import { conUsuario, ok } from "@/lib/api";
import { resumenAdmin } from "@/lib/admin/consultas";
import { SOLO_ADMIN } from "@/lib/admin/api";

export const GET = conUsuario(async () => ok(await resumenAdmin()), SOLO_ADMIN);

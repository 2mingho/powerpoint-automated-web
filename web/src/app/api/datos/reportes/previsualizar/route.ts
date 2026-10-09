import { conUsuario } from "@/lib/api";
import { LIMITES } from "@/lib/datos/limites";
import { reenviarSubida } from "@/lib/datos/servicio";

/* Que widget de Meltwater es cada archivo, antes de generar. */
export const POST = conUsuario(async (req, u) => reenviarSubida(req, "/reportes/previsualizar", u, LIMITES.reports), { herramienta: "reports" });

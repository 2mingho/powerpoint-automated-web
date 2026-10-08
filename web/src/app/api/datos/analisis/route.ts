import { conUsuario } from "@/lib/api";
import { LIMITES } from "@/lib/datos/limites";
import { reenviarSubida } from "@/lib/datos/servicio";

/* Lanza el proceso: el archivo pasa en streaming al servicio, que responde 202 con el trabajo. */
export const POST = conUsuario(async (req, u) => reenviarSubida(req, "/analisis", u, LIMITES.csv_analysis), { herramienta: "csv_analysis" });

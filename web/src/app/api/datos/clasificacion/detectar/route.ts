import { conUsuario } from "@/lib/api";
import { LIMITES } from "@/lib/datos/limites";
import { reenviarSubida } from "@/lib/datos/servicio";

/* Codificacion, separador, columnas y cinco filas de muestra. */
export const POST = conUsuario(async (req, u) => reenviarSubida(req, "/clasificacion/detectar", u, LIMITES.classification), { herramienta: "classification" });

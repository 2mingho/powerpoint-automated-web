import { conUsuario, cuerpo, ok } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { crearPreset, listarPresets, nombreValido, validarReglas } from "@/lib/datos/presets";

export const GET = conUsuario(async (_req, u) => ok({ presets: await listarPresets(u.id) }), { herramienta: "classification" });

export const POST = conUsuario(async (req, u) => {
  const c = await cuerpo(req);
  const nombre = nombreValido(c.nombre);
  const p = await crearPreset(u.id, nombre, validarReglas(c.reglas ?? []));
  await registrarActividad(u.id, "preset_create", `Preset guardado: ${nombre}`);
  return ok(p, 201);
}, { herramienta: "classification" });

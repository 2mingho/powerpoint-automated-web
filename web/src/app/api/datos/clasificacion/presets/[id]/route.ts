import { conUsuario, cuerpo, ok } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { actualizarPreset, borrarPreset, nombreValido, presetPropio, validarReglas } from "@/lib/datos/presets";

type Ctx = RouteContext<"/api/datos/clasificacion/presets/[id]">;

export const GET = conUsuario(async (_req, u, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await presetPropio(u.id, Number(id)));
}, { herramienta: "classification" });

export const PUT = conUsuario(async (req, u, ctx: Ctx) => {
  const { id } = await ctx.params;
  const c = await cuerpo(req);
  const p = await actualizarPreset(u.id, Number(id), {
    nombre: c.nombre !== undefined ? nombreValido(c.nombre) : undefined,
    reglas: c.reglas !== undefined ? validarReglas(c.reglas) : undefined,
  });
  await registrarActividad(u.id, "preset_update", `Preset actualizado: ${p.nombre}`);
  return ok(p);
}, { herramienta: "classification" });

export const DELETE = conUsuario(async (_req, u, ctx: Ctx) => {
  const { id } = await ctx.params;
  const nombre = await borrarPreset(u.id, Number(id));
  await registrarActividad(u.id, "preset_delete", `Preset eliminado: ${nombre}`);
  return ok({ ok: true });
}, { herramienta: "classification" });

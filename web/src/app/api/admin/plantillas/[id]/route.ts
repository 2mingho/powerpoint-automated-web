import { conUsuario, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { idDeRuta, SOLO_ADMIN } from "@/lib/admin/api";

/* Descargar la que esta en uso, para revisarla o partir de ella. */
export const GET = conUsuario<RouteContext<"/api/admin/plantillas/[id]">>(async (_req, _u, ctx) => {
  const p = await db.pptx_templates.findUnique({ where: { id: await idDeRuta(ctx) } });
  if (!p) throw new ErrorApi(404, "Plantilla no encontrada.");
  return new Response(new Uint8Array(p.data), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${p.name.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}, SOLO_ADMIN);

export const DELETE = conUsuario<RouteContext<"/api/admin/plantillas/[id]">>(async (_req, u, ctx) => {
  const id = await idDeRuta(ctx);
  const p = await db.pptx_templates.findUnique({ where: { id }, select: { name: true } });
  if (!p) throw new ErrorApi(404, "Plantilla no encontrada.");
  await db.pptx_templates.delete({ where: { id } });
  await registrarActividad(u.id, "pptx_template_delete", `Plantilla eliminada: ${p.name}`, { tipo: "pptx_template", id });
  return ok({ id });
}, SOLO_ADMIN);

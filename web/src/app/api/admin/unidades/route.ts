import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { organizacion } from "@/lib/admin/consultas";
import { SOLO_ADMIN, texto } from "@/lib/admin/api";

export const GET = conUsuario(async () => ok({ unidades: (await organizacion()).unidades }), SOLO_ADMIN);

export const POST = conUsuario(async (req, u) => {
  const d = await cuerpo(req);
  const nombre = texto(d.nombre, 100);
  const descripcion = texto(d.descripcion, 500);
  if (!nombre) throw new ErrorApi(400, "El nombre de la unidad es obligatorio.");
  if (await db.areas.findFirst({ where: { name: { equals: nombre, mode: "insensitive" } }, select: { id: true } })) {
    throw new ErrorApi(409, `La unidad "${nombre}" ya existe.`);
  }
  const a = await db.areas.create({ data: { name: nombre, description: descripcion, created_at: new Date() } });
  await registrarActividad(u.id, "area_create", `Unidad creada: ${nombre}`, { tipo: "area", id: a.id });
  return ok({ id: a.id }, 201);
}, SOLO_ADMIN);

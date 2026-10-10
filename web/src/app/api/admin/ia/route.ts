import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { ia } from "@/lib/admin/consultas";
import { SOLO_ADMIN } from "@/lib/admin/api";
import { leerConexion, nombreLibre } from "@/lib/admin/ia";

/* Conexiones (con la clave enmascarada) y consumo agregado. */
export const GET = conUsuario(async () => ok(await ia()), SOLO_ADMIN);

export const POST = conUsuario(async (req, u) => {
  const c = leerConexion(await cuerpo(req));
  if (!c.clave) throw new ErrorApi(400, "La clave API es obligatoria al crear una conexión.");
  await nombreLibre(c.nombre);
  const nueva = await db.ai_providers.create({
    data: {
      name: c.nombre, provider: c.proveedor, model: c.modelo, api_key: c.clave, is_active: false, created_at: new Date(),
      created_by_id: u.id, price_in_per_1m: c.precioIn, price_out_per_1m: c.precioOut,
    },
    select: { id: true },
  });
  // La clave nunca entra en el registro de actividad.
  await registrarActividad(u.id, "ai_provider_create", `Conexión IA creada: ${c.nombre} (${c.proveedor}/${c.modelo})`, { tipo: "ai_provider", id: nueva.id });
  return ok({ id: nueva.id }, 201);
}, SOLO_ADMIN);

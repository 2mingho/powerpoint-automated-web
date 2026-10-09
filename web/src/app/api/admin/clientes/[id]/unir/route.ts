import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { idDeRuta, SOLO_ADMIN } from "@/lib/admin/api";
import { unirClientes } from "@/lib/clientes/admin";

/* Une este cliente (el que se va) en `destinoId` (el que se queda). */
export const POST = conUsuario<RouteContext<"/api/admin/clientes/[id]/unir">>(async (req, u, ctx) => {
  const origen = await idDeRuta(ctx);
  const destino = Number((await cuerpo(req)).destinoId);
  if (!Number.isInteger(destino) || destino <= 0) throw new ErrorApi(400, "Elige el cliente en el que se une.");
  return ok(await unirClientes(u.id, origen, destino));
}, SOLO_ADMIN);

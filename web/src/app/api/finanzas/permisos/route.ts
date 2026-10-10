import { conUsuario, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { concesionesDe, unidadesVisiblesFinanzas } from "@/lib/finanzas/permisos";
import { alcanceUnidades } from "@/lib/alcance";

/*
 * Lo que la persona puede hacer con los ingresos: que unidades ve y cuales
 * puede editar (contratos / metas). La interfaz lo usa para mostrar u ocultar
 * acciones; el servidor lo vuelve a comprobar en cada escritura.
 */
export const GET = conUsuario(async (_req, u) => {
  const [visibles, supervisadas, c, areas] = await Promise.all([
    unidadesVisiblesFinanzas(u), alcanceUnidades(u), concesionesDe(u.id),
    db.areas.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const nombre = new Map(areas.map((a) => [a.id, a.name]));
  const lista = (ids: number[]) => ids.map((id) => ({ id, nombre: nombre.get(id) ?? "" })).filter((x) => x.nombre);
  const todas = u.isAdmin ? areas.map((a) => a.id) : null;
  return ok({
    admin: u.isAdmin,
    ver: lista(visibles),
    supervisa: lista(supervisadas),
    editar: { contracts: lista(todas ?? c.contracts), goals: lista(todas ?? c.goals) },
  });
});

import "server-only";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { estadosFinales } from "@/lib/catalogo";
import { hoyNegocio, isoDeFecha, fechaDeIso } from "@/lib/reloj";
import type { UsuarioActual } from "@/lib/auth/session";
import { filtroTareasVisibles } from "@/lib/tareas/alcance";
import { sumarDias } from "@/lib/tareas/fechas";
import { puntualidad } from "@/lib/seguimiento/riesgo";

/*
 * Ficha de un cliente (la que flota sobre su nombre). Todo se cuenta sobre las
 * tareas que QUIEN PREGUNTA puede ver: dos gerentes ven numeros distintos del
 * mismo cliente, y quien no ve ninguna tarea suya recibe 404, igual que si el
 * cliente no existiera. Tipo y lider de cuenta son del cliente, no de las
 * tareas, pero solo salen si se ve al menos una.
 */
export type FichaCliente = {
  id: number;
  nombre: string;
  tipo: string;
  lider: string;
  activo: boolean;
  abiertas: number;
  vencidas: number;
  proximas: { id: number; titulo: string; entrega: string; estado: string; asignado: string }[];
  /* Entre lo cerrado en los ultimos 30 dias: % que llego a tiempo (null si no hubo nada con fecha de cierre) y cuantas tareas son. */
  aTiempo: { porcentaje: number | null; cerradas: number };
  unidades: string[];
};

export async function fichaDeCliente(u: UsuarioActual, id: number): Promise<FichaCliente> {
  const noHay = () => new ErrorApi(404, "No hay tareas de ese cliente que puedas ver.");
  if (!Number.isInteger(id) || id <= 0) throw noHay();
  const visibles = { AND: [await filtroTareasVisibles(u), { client_id: id }] };
  const [cliente, total] = await Promise.all([
    db.clients.findUnique({ where: { id }, select: { id: true, name: true, client_type: true, is_active: true, responsable: { select: { username: true } } } }),
    db.tasks.count({ where: visibles }),
  ]);
  if (!cliente || !total) throw noHay();

  const hoy = hoyNegocio();
  const hoyDb = fechaDeIso(hoy)!;
  const finales = await estadosFinales();
  const abiertas = { AND: [visibles, { status: { notIn: finales } }] };
  const desde = sumarDias(hoy, -30);

  const [nAbiertas, nVencidas, proximas, cerradas, unidades] = await Promise.all([
    db.tasks.count({ where: abiertas }),
    db.tasks.count({ where: { AND: [abiertas, { due_date: { lt: hoyDb } }] } }),
    db.tasks.findMany({
      where: { AND: [abiertas, { due_date: { gte: hoyDb } }] },
      orderBy: [{ due_date: "asc" }, { id: "asc" }], take: 3,
      select: { id: true, title: true, due_date: true, status: true, asignado: { select: { username: true } } },
    }),
    // Un dia de margen: done_at es UTC y el corte es por dia de negocio.
    db.tasks.findMany({
      where: { AND: [visibles, { status: { in: finales } }, { done_at: { gte: new Date(`${sumarDias(desde, -1)}T00:00:00Z`) } }] },
      select: { due_date: true, done_at: true }, take: 2000,
    }),
    db.tasks.groupBy({ by: ["area"], where: visibles }),
  ]);

  const recientes = cerradas
    .map((t) => ({ entrega: isoDeFecha(t.due_date), hechaEl: hoyNegocio(t.done_at!) }))
    .filter((t) => t.hechaEl >= desde);
  const porcentaje = puntualidad(recientes.map((t) => ({ estado: "hecha" as const, horas: 0, esEntrega: true, ...t })), hoy);

  return {
    id: cliente.id,
    nombre: cliente.name,
    tipo: cliente.client_type ?? "",
    lider: cliente.responsable?.username ?? "",
    activo: cliente.is_active,
    abiertas: nAbiertas,
    vencidas: nVencidas,
    proximas: proximas.map((t) => ({ id: t.id, titulo: t.title, entrega: isoDeFecha(t.due_date), estado: t.status, asignado: t.asignado.username })),
    aTiempo: { porcentaje, cerradas: recientes.length },
    unidades: unidades.map((x) => x.area).sort((a, b) => a.localeCompare(b, "es")).slice(0, 6),
  };
}

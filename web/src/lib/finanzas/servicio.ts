import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { ErrorApi } from "@/lib/api";
import { db } from "@/lib/db";
import type { UsuarioActual } from "@/lib/auth/session";
import { registrarActividad } from "@/lib/actividad";
import { fechaDeIso, isoDeFecha } from "@/lib/reloj";
import { filasFin, mesesDe, porMes } from "@/lib/seguimiento/finanzas";
import { leerAnio, leerContrato, leerMonto, TIPOS_CONTRATO, textoDeProrrateo, usd, type DatosContrato } from "./contratos";
import { exigirEditarFinanzas, puedeEditarFinanzas, unidadesEditables, unidadesVisiblesFinanzas } from "./permisos";

/*
 * Contratos y metas de ingresos. Visibilidad y edicion por unidad (permisos.ts):
 * lo que la persona no ve no existe para ella (404), y a lo que ve sin poder
 * editar responde 403. Todo en USD; el monto es el total del contrato y se
 * prorratea por meses naturales (seguimiento/finanzas.ts).
 */

type Pieza = Pick<UsuarioActual, "id" | "isAdmin">;

const dinero = (d: Prisma.Decimal | number) => Number(d.toString());

const INCLUIR = {
  cliente: { select: { id: true, name: true, client_type: true } },
  unidad: { select: { id: true, name: true } },
  asigna: { select: { id: true, name: true } },
} satisfies Prisma.contractsInclude;
type Fila = Prisma.contractsGetPayload<{ include: typeof INCLUIR }>;

export type ContratoDTO = {
  id: number;
  cliente: { id: number; nombre: string; tipo: string };
  unidad: { id: number; nombre: string };
  asigna: { id: number; nombre: string } | null;
  tipo: string;
  monto: number;
  inicio: string;
  fin: string;
  meses: number;
  porMes: number;
  nota: string;
  puedeEditar: boolean;
  /* Con `anio`: lo que el contrato aporta a ese año, mes a mes. */
  anio?: { total: number; meses: number[] };
};

function aDTO(c: Fila, editables: Set<number>): ContratoDTO {
  const monto = dinero(c.amount);
  const inicio = isoDeFecha(c.start_date);
  const fin = isoDeFecha(c.end_date);
  return {
    id: c.id,
    cliente: { id: c.cliente.id, nombre: c.cliente.name, tipo: c.cliente.client_type ?? "" },
    unidad: { id: c.unidad.id, nombre: c.unidad.name },
    asigna: c.asigna ? { id: c.asigna.id, nombre: c.asigna.name } : null,
    tipo: c.contract_type,
    monto,
    inicio,
    fin,
    meses: mesesDe({ inicio, fin }).length,
    porMes: Math.round(porMes({ monto, inicio, fin }) * 100) / 100,
    nota: c.note ?? "",
    puedeEditar: editables.has(c.area_id),
  };
}

export type FiltroContratos = { anio: number | null; unidadId: number | null; clienteId: number | null; tipo: string };

export function leerFiltroContratos(p: URLSearchParams): FiltroContratos {
  const entero = (v: string | null) => (v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);
  const anio = p.get("anio") ? leerAnio(p.get("anio")) : null;
  if (anio && !anio.ok) throw new ErrorApi(400, anio.error);
  return { anio: anio?.ok ? anio.valor : null, unidadId: entero(p.get("unidad")), clienteId: entero(p.get("cliente")), tipo: p.get("tipo") ?? "" };
}

/* Contratos de las unidades que la persona ve, con lo que aportan al año si se pide. */
export async function listarContratos(u: Pieza, f: FiltroContratos): Promise<{ contratos: ContratoDTO[]; truncado: boolean }> {
  const visibles = await unidadesVisiblesFinanzas(u);
  const unidades = f.unidadId ? visibles.filter((id) => id === f.unidadId) : visibles;
  if (!unidades.length) return { contratos: [], truncado: false };
  const where: Prisma.contractsWhereInput = {
    area_id: { in: unidades },
    ...(f.clienteId ? { client_id: f.clienteId } : {}),
    ...(TIPOS_CONTRATO.some((t) => t === f.tipo) ? { contract_type: f.tipo } : {}),
    ...(f.anio ? { start_date: { lte: fechaDeIso(`${f.anio}-12-31`)! }, end_date: { gte: fechaDeIso(`${f.anio}-01-01`)! } } : {}),
  };
  const [filas, editables] = await Promise.all([
    db.contracts.findMany({ where, include: INCLUIR, orderBy: [{ start_date: "desc" }, { id: "desc" }], take: 2001 }),
    unidadesEditables(u, "contracts"),
  ]);
  const truncado = filas.length > 2000;
  if (truncado) filas.length = 2000;
  const dtos = filas.map((c) => aDTO(c, new Set(editables)));
  if (!f.anio) return { contratos: dtos, truncado };
  const del = new Map(filasFin(dtos.map((c) => ({ ...c, monto: c.monto, inicio: c.inicio, fin: c.fin })), f.anio).map((r) => [r.contrato.id, r]));
  return { contratos: dtos.filter((c) => del.has(c.id)).map((c) => ({ ...c, anio: { total: Math.round(del.get(c.id)!.total * 100) / 100, meses: del.get(c.id)!.meses.map((x) => Math.round(x * 100) / 100) } })), truncado };
}

async function verificarReferencias(d: DatosContrato) {
  const [cliente, unidad, asigna] = await Promise.all([
    db.clients.findUnique({ where: { id: d.clienteId }, select: { id: true, name: true, is_active: true } }),
    db.areas.findUnique({ where: { id: d.unidadId }, select: { id: true, name: true } }),
    d.asignaId ? db.areas.findUnique({ where: { id: d.asignaId }, select: { id: true } }) : Promise.resolve(true),
  ]);
  if (!cliente) throw new ErrorApi(400, "El cliente no existe.");
  if (!unidad) throw new ErrorApi(400, "La unidad no existe.");
  if (!asigna) throw new ErrorApi(400, "La unidad que asigna no existe.");
  return { cliente, unidad };
}

const resumen = (d: DatosContrato) => `${usd(d.monto)}, ${d.inicio} a ${d.fin}`;

export async function crearContrato(u: Pieza, crudo: Record<string, unknown>) {
  // Primero el permiso: quien no ve la unidad no debe aprender nada de la validacion.
  const unidad = Number(crudo.unidadId);
  if (!Number.isInteger(unidad) || unidad <= 0) throw new ErrorApi(400, "Elige la unidad del contrato.");
  await exigirEditarFinanzas(u, "contracts", unidad);
  const d = leerContrato(crudo);
  if (!d.ok) throw new ErrorApi(400, d.error);
  const { cliente, unidad: un } = await verificarReferencias(d.valor);
  const c = await db.contracts.create({
    data: {
      client_id: d.valor.clienteId, area_id: d.valor.unidadId, contract_type: d.valor.tipo, amount: d.valor.monto,
      start_date: fechaDeIso(d.valor.inicio)!, end_date: fechaDeIso(d.valor.fin)!, from_area_id: d.valor.asignaId, note: d.valor.nota || null,
      created_by: u.id, created_at: new Date(), updated_at: new Date(),
    },
    select: { id: true },
  });
  await registrarActividad(u.id, "contract_create", `Contrato #${c.id} de «${cliente.name}» en «${un.name}»: ${resumen(d.valor)}`, { tipo: "contract", id: c.id });
  return { id: c.id, prorrateo: textoDeProrrateo(d.valor) };
}

export async function contratoEditable(u: Pieza, id: number): Promise<Fila> {
  const c = await db.contracts.findUnique({ where: { id }, include: INCLUIR });
  // No se ve = no existe; asi no se distingue un contrato ajeno de uno inexistente.
  if (!c || !(await unidadesVisiblesFinanzas(u)).includes(c.area_id)) throw new ErrorApi(404, "Contrato no encontrado.");
  return c;
}

export async function leerContratoVisible(u: Pieza, id: number): Promise<ContratoDTO> {
  const c = await contratoEditable(u, id);
  return aDTO(c, new Set(await unidadesEditables(u, "contracts")));
}

/* Edicion parcial: lo que no llega no cambia. Cambiar de unidad exige poder editar las dos. */
export async function editarContrato(u: Pieza, id: number, crudo: Record<string, unknown>) {
  const actual = await contratoEditable(u, id);
  await exigirEditarFinanzas(u, "contracts", actual.area_id);
  const mezcla = {
    clienteId: actual.client_id, unidadId: actual.area_id, tipo: actual.contract_type, monto: dinero(actual.amount),
    inicio: isoDeFecha(actual.start_date), fin: isoDeFecha(actual.end_date), asignaId: actual.from_area_id, nota: actual.note ?? "",
    ...Object.fromEntries(Object.entries(crudo).filter(([k]) => ["clienteId", "unidadId", "tipo", "monto", "inicio", "fin", "asignaId", "nota"].includes(k))),
  };
  // Una Asignación que pasa a otro tipo deja de tener unidad que asigna.
  if (mezcla.tipo !== "Asignación" && !("asignaId" in crudo)) mezcla.asignaId = null;
  const d = leerContrato(mezcla);
  if (!d.ok) throw new ErrorApi(400, d.error);
  if (d.valor.unidadId !== actual.area_id) await exigirEditarFinanzas(u, "contracts", d.valor.unidadId);
  const { cliente, unidad } = await verificarReferencias(d.valor);
  await db.contracts.update({
    where: { id },
    data: {
      client_id: d.valor.clienteId, area_id: d.valor.unidadId, contract_type: d.valor.tipo, amount: d.valor.monto,
      start_date: fechaDeIso(d.valor.inicio)!, end_date: fechaDeIso(d.valor.fin)!, from_area_id: d.valor.asignaId, note: d.valor.nota || null,
      updated_at: new Date(),
    },
  });
  await registrarActividad(u.id, "contract_update", `Contrato #${id} de «${cliente.name}» en «${unidad.name}»: ${resumen(d.valor)} (antes ${usd(dinero(actual.amount))}, ${isoDeFecha(actual.start_date)} a ${isoDeFecha(actual.end_date)})`, { tipo: "contract", id });
  return { prorrateo: textoDeProrrateo(d.valor) };
}

export async function borrarContrato(u: Pieza, id: number) {
  const c = await contratoEditable(u, id);
  await exigirEditarFinanzas(u, "contracts", c.area_id);
  await db.contracts.delete({ where: { id } });
  await registrarActividad(u.id, "contract_delete", `Eliminó el contrato #${id} de «${c.cliente.name}» en «${c.unidad.name}» (${usd(dinero(c.amount))})`, { tipo: "contract", id });
}

/* ── Metas ── */

export type MetaDTO = { unidadId: number | null; nombre: string; monto: number; puedeEditar: boolean };

/*
 * La meta de la direccion es de toda la organizacion: la ven Administracion y
 * quien ya ve los ingresos de todas las unidades; solo Administracion la fija.
 */
async function veDireccion(u: Pieza, visibles: number[]) {
  if (u.isAdmin) return true;
  const total = await db.areas.count();
  return total > 0 && visibles.length === total;
}

export async function metasDelAnio(u: Pieza, anioCrudo: unknown): Promise<{ anio: number; direccion: MetaDTO | null; unidades: MetaDTO[] }> {
  const anio = leerAnio(anioCrudo);
  if (!anio.ok) throw new ErrorApi(400, anio.error);
  const visibles = await unidadesVisiblesFinanzas(u);
  const [areas, metas, editables, direccion] = await Promise.all([
    db.areas.findMany({ where: { id: { in: visibles } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.goals.findMany({ where: { year: anio.valor } }),
    unidadesEditables(u, "goals"),
    veDireccion(u, visibles),
  ]);
  const por = new Map(metas.map((m) => [m.area_id, dinero(m.amount)]));
  const editar = new Set(editables);
  return {
    anio: anio.valor,
    direccion: direccion ? { unidadId: null, nombre: "Dirección", monto: por.get(null) ?? 0, puedeEditar: u.isAdmin } : null,
    unidades: areas.map((a) => ({ unidadId: a.id, nombre: a.name, monto: por.get(a.id) ?? 0, puedeEditar: editar.has(a.id) })),
  };
}

/* Fija la meta de un año (monto 0 la quita). unidadId null es la de la direccion. */
export async function fijarMeta(u: Pieza, crudo: Record<string, unknown>) {
  const anio = leerAnio(crudo.anio);
  if (!anio.ok) throw new ErrorApi(400, anio.error);
  const unidadId = crudo.unidadId === null || crudo.unidadId === undefined ? null : Number(crudo.unidadId);
  if (unidadId !== null && (!Number.isInteger(unidadId) || unidadId <= 0)) throw new ErrorApi(400, "La unidad no es válida.");
  let nombre = "Dirección";
  if (unidadId === null) {
    const visibles = await unidadesVisiblesFinanzas(u);
    if (!u.isAdmin) throw new ErrorApi((await veDireccion(u, visibles)) ? 403 : 404, (await veDireccion(u, visibles)) ? "Solo Administración fija la meta de la dirección." : "Meta no encontrada.");
  } else {
    await exigirEditarFinanzas(u, "goals", unidadId);
    nombre = (await db.areas.findUnique({ where: { id: unidadId }, select: { name: true } }))!.name;
  }
  const monto = leerMonto(crudo.monto, { permitirCero: true });
  if (!monto.ok) throw new ErrorApi(400, monto.error);

  const donde = { year: anio.valor, area_id: unidadId };
  const previa = await db.goals.findFirst({ where: donde, select: { id: true, amount: true } });
  if (monto.valor === 0) {
    if (previa) await db.goals.delete({ where: { id: previa.id } });
  } else if (previa) {
    await db.goals.update({ where: { id: previa.id }, data: { amount: monto.valor, updated_by: u.id, updated_at: new Date() } });
  } else {
    await db.goals.create({ data: { ...donde, amount: monto.valor, updated_by: u.id, updated_at: new Date() } });
  }
  await registrarActividad(u.id, "goal_set", `Meta ${anio.valor} de «${nombre}»: ${usd(monto.valor)}${previa ? ` (antes ${usd(dinero(previa.amount))})` : ""}`, { tipo: "goal", id: previa?.id ?? null });
  return { anio: anio.valor, unidadId, monto: monto.valor };
}

export { puedeEditarFinanzas };

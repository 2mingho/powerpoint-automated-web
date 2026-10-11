import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { ErrorApi } from "@/lib/api";
import { db } from "@/lib/db";
import type { UsuarioActual } from "@/lib/auth/session";
import { registrarActividad } from "@/lib/actividad";
import { fechaDeIso, hoyNegocio, isoDeFecha } from "@/lib/reloj";
import { horasDelTrimestre, matrizDelTrimestre, reporteDePeriodo, type EntradaHoras } from "./agregados";
import { exigirEditarHorasExtras, exigirVerHorasExtras, unidadesQueEditanHorasExtras, unidadesQueVenHorasExtras } from "./permisos";
import {
  avisoDeLimite, leerPeriodo, leerRegistro, mesesDelTrimestre, periodoDe, rotuloPeriodo, trimestreDe, type Aviso, type Periodo,
} from "./reglas";

/*
 * Horas extras de una unidad (el reporte de Media Watch). Visibilidad y edicion en permisos.ts. El limite por trimestre
 * AVISA, no bloquea: pasarse queda a criterio del gerente y a la vista de todos (mapa de calor).
 */
type Pieza = Pick<UsuarioActual, "id" | "isAdmin">;

const dinero = (d: Prisma.Decimal | number) => Number(d.toString());

const SELECT = {
  id: true, user_id: true, work_date: true, detail: true, schedule: true, hours: true, period_year: true, period_month: true, period_half: true,
  persona: { select: { username: true } },
} satisfies Prisma.overtime_entriesSelect;
type Fila = Prisma.overtime_entriesGetPayload<{ select: typeof SELECT }>;

function aEntrada(f: Fila): EntradaHoras {
  return {
    id: f.id, personaId: f.user_id, personaNombre: f.persona.username, fecha: isoDeFecha(f.work_date), detalle: f.detail, horario: f.schedule ?? "",
    horas: dinero(f.hours), periodo: { anio: f.period_year, mes: f.period_month, mitad: f.period_half === 15 ? 15 : 30 },
  };
}

/* Periodo que pide la URL (?anio=&mes=&mitad=); sin el, la quincena en curso. */
export function leerPeriodoPedido(p: URLSearchParams, hoy = hoyNegocio()): Periodo {
  const pedido = leerPeriodo({ anio: p.get("anio"), mes: p.get("mes"), mitad: p.get("mitad") });
  return pedido.ok ? pedido.valor : periodoDe(hoy);
}

export type DatosHorasExtras = {
  unidades: { id: number; nombre: string; limite: number; editable: boolean }[];
  unidad: { id: number; nombre: string; limite: number } | null;
  periodo: Periodo;
  rotulo: string;
  trimestre: number;
  puedeEditar: boolean;
  /* La plantilla de la unidad (activas) a la que se le pueden registrar horas. */
  personas: { id: number; nombre: string }[];
  reporte: ReturnType<typeof reporteDePeriodo>;
  matriz: ReturnType<typeof matrizDelTrimestre>;
};

const VACIO_REPORTE = (periodo: Periodo) => reporteDePeriodo([], periodo);

/* Todos los registros del trimestre del periodo en una unidad (de ahi salen el reporte, la matriz y los avisos). */
async function entradasDelTrimestre(unidadId: number, anio: number, trimestre: number): Promise<EntradaHoras[]> {
  const filas = await db.overtime_entries.findMany({
    where: { area_id: unidadId, period_year: anio, period_month: { in: mesesDelTrimestre(trimestre) } },
    select: SELECT, orderBy: [{ work_date: "asc" }, { id: "asc" }],
  });
  return filas.map(aEntrada);
}

export async function datosDeHorasExtras(u: Pieza, unidadPedida: number | null, periodo: Periodo): Promise<DatosHorasExtras> {
  const [ven, editan] = await Promise.all([unidadesQueVenHorasExtras(u), unidadesQueEditanHorasExtras(u)]);
  const filas = ven.length ? await db.areas.findMany({ where: { id: { in: ven } }, select: { id: true, name: true, overtime_limit: true }, orderBy: { name: "asc" } }) : [];
  const unidades = filas.map((a) => ({ id: a.id, nombre: a.name, limite: dinero(a.overtime_limit), editable: editan.includes(a.id) }));
  const elegida = (unidadPedida && unidades.find((x) => x.id === unidadPedida)) || unidades.find((x) => x.editable) || unidades[0] || null;
  const trimestre = trimestreDe(periodo.mes);
  const base = { unidades, periodo, rotulo: rotuloPeriodo(periodo), trimestre };
  if (!elegida) {
    return { ...base, unidad: null, puedeEditar: false, personas: [], reporte: VACIO_REPORTE(periodo), matriz: matrizDelTrimestre([], [], periodo.anio, trimestre, 80) };
  }
  const [entradas, personas] = await Promise.all([
    entradasDelTrimestre(elegida.id, periodo.anio, trimestre),
    db.users.findMany({ where: { area_id: elegida.id, is_active: true }, select: { id: true, username: true }, orderBy: { username: "asc" } }),
  ]);
  const plantilla = personas.map((p) => ({ id: p.id, nombre: p.username }));
  return {
    ...base,
    unidad: { id: elegida.id, nombre: elegida.nombre, limite: elegida.limite },
    puedeEditar: elegida.editable,
    personas: plantilla,
    reporte: reporteDePeriodo(entradas, periodo),
    matriz: matrizDelTrimestre(entradas, plantilla, periodo.anio, trimestre, elegida.limite),
  };
}

export type ResultadoRegistro = { id: number; horasTrimestre: number; limite: number; aviso: Aviso };

/* Despues de guardar: cuanto lleva la persona en el trimestre del reporte y si ya hay que avisar. */
async function estadoDelTrimestre(unidadId: number, personaId: number, periodo: Periodo, limite: number) {
  const horasTrimestre = horasDelTrimestre(await entradasDelTrimestre(unidadId, periodo.anio, trimestreDe(periodo.mes)), personaId, periodo);
  return { horasTrimestre, limite, aviso: avisoDeLimite(horasTrimestre, limite) };
}

async function personaDeLaUnidad(personaId: number) {
  const p = await db.users.findUnique({ where: { id: personaId }, select: { id: true, username: true, area_id: true, is_active: true, areas: { select: { name: true, has_overtime: true, overtime_limit: true } } } });
  if (!p || p.area_id === null || !p.areas?.has_overtime) throw new ErrorApi(404, "Esa persona no es de una unidad con horas extras.");
  return { id: p.id, nombre: p.username, unidadId: p.area_id, activa: p.is_active, unidad: p.areas.name, limite: dinero(p.areas.overtime_limit) };
}

export async function crearRegistro(u: Pieza, crudo: Record<string, unknown>): Promise<ResultadoRegistro> {
  const personaId = Number(crudo.personaId);
  if (!Number.isInteger(personaId) || personaId <= 0) throw new ErrorApi(400, "Elige la persona.");
  // La unidad sale de la persona, no del cuerpo: no se registran horas de una unidad ajena aunque se mande otra.
  const persona = await personaDeLaUnidad(personaId);
  await exigirEditarHorasExtras(u, persona.unidadId);
  const d = leerRegistro(crudo);
  if (!d.ok) throw new ErrorApi(400, d.error);
  if (!persona.activa) throw new ErrorApi(400, "Esa persona ya no está activa.");
  const r = await db.overtime_entries.create({
    data: {
      area_id: persona.unidadId, user_id: persona.id, work_date: fechaDeIso(d.valor.fecha)!, detail: d.valor.detalle, schedule: d.valor.horario || null, hours: d.valor.horas,
      period_year: d.valor.periodo.anio, period_month: d.valor.periodo.mes, period_half: d.valor.periodo.mitad, created_by: u.id, created_at: new Date(), updated_at: new Date(),
    },
    select: { id: true },
  });
  await registrarActividad(u.id, "overtime_create", `Horas extras #${r.id} de ${persona.nombre} (${persona.unidad}): ${d.valor.horas} h el ${d.valor.fecha}, ${rotuloPeriodo(d.valor.periodo, false)}`, { tipo: "overtime", id: r.id });
  return { id: r.id, ...(await estadoDelTrimestre(persona.unidadId, persona.id, d.valor.periodo, persona.limite)) };
}

async function registroVisible(u: Pieza, id: number) {
  const f = await db.overtime_entries.findUnique({ where: { id }, select: { ...SELECT, area_id: true } });
  if (!f || !(await unidadesQueVenHorasExtras(u)).includes(f.area_id)) throw new ErrorApi(404, "Registro no encontrado.");
  return f;
}

/* Edicion parcial; la persona no se cambia (se borra y se registra a la otra). */
export async function editarRegistro(u: Pieza, id: number, crudo: Record<string, unknown>): Promise<ResultadoRegistro> {
  const actual = await registroVisible(u, id);
  await exigirEditarHorasExtras(u, actual.area_id);
  const permitidos = ["fecha", "detalle", "horario", "horas", "periodo"];
  const mezcla = {
    personaId: actual.user_id, fecha: isoDeFecha(actual.work_date), detalle: actual.detail, horario: actual.schedule ?? "", horas: dinero(actual.hours),
    periodo: { anio: actual.period_year, mes: actual.period_month, mitad: actual.period_half },
    ...Object.fromEntries(Object.entries(crudo).filter(([k]) => permitidos.includes(k))),
  };
  const d = leerRegistro(mezcla);
  if (!d.ok) throw new ErrorApi(400, d.error);
  await db.overtime_entries.update({
    where: { id },
    data: {
      work_date: fechaDeIso(d.valor.fecha)!, detail: d.valor.detalle, schedule: d.valor.horario || null, hours: d.valor.horas,
      period_year: d.valor.periodo.anio, period_month: d.valor.periodo.mes, period_half: d.valor.periodo.mitad, updated_at: new Date(),
    },
  });
  const unidad = await db.areas.findUnique({ where: { id: actual.area_id }, select: { name: true, overtime_limit: true } });
  await registrarActividad(u.id, "overtime_edit", `Horas extras #${id} de ${actual.persona.username} (${unidad?.name}) editadas: ${d.valor.horas} h el ${d.valor.fecha}, ${rotuloPeriodo(d.valor.periodo, false)}`, { tipo: "overtime", id });
  return { id, ...(await estadoDelTrimestre(actual.area_id, actual.user_id, d.valor.periodo, dinero(unidad?.overtime_limit ?? 80))) };
}

export async function borrarRegistro(u: Pieza, id: number) {
  const actual = await registroVisible(u, id);
  await exigirEditarHorasExtras(u, actual.area_id);
  await db.overtime_entries.delete({ where: { id } });
  await registrarActividad(u.id, "overtime_delete", `Horas extras #${id} de ${actual.persona.username} eliminadas: ${dinero(actual.hours)} h el ${isoDeFecha(actual.work_date)}`, { tipo: "overtime", id });
}

/* Datos para el libro de Excel: el reporte de la quincena y la matriz de todo el año. */
export async function datosParaLibro(u: Pieza, unidadId: number, periodo: Periodo) {
  await exigirVerHorasExtras(u, unidadId);
  const unidad = await db.areas.findUnique({ where: { id: unidadId }, select: { name: true, overtime_limit: true } });
  if (!unidad) throw new ErrorApi(404, "Unidad no encontrada.");
  const [filas, personas] = await Promise.all([
    db.overtime_entries.findMany({ where: { area_id: unidadId, period_year: periodo.anio }, select: SELECT, orderBy: [{ work_date: "asc" }, { id: "asc" }] }),
    db.users.findMany({ where: { area_id: unidadId, is_active: true }, select: { id: true, username: true }, orderBy: { username: "asc" } }),
  ]);
  return {
    unidad: unidad.name, limite: dinero(unidad.overtime_limit), periodo, entradas: filas.map(aEntrada),
    personas: personas.map((p) => ({ id: p.id, nombre: p.username })),
  };
}


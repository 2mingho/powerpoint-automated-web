import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { puedeVerEquipo } from "@/lib/alcance";
import { estadoInicial, estadosFinales, prioridadesValidas, prioridadPorDefecto } from "@/lib/catalogo";
import { hoyNegocio } from "@/lib/reloj";
import type { UsuarioActual } from "@/lib/auth/session";
import { filtroTareasVisibles, idsUsuariosDelAmbito } from "@/lib/tareas/alcance";
import { areaDe, diaDb, MAX_DESCRIPCION } from "./base";
import { condicionesFiltro } from "./consultas";
import {
  CAMPOS_CSV, COLUMNAS_CSV, camposVacios, decodificarCsv, erroresPlanos, escribirCsv, extraerFilasCsv, neutralizarFormula,
  validarFilaCsv, vistaPreviaCsv, type ContextoCsv, type ErrorPlano, type FilaCsv, type FilaVistaPrevia, type PersonaCsv,
} from "./csv";
import { formatoMdy } from "./fechas";
import type { Filtros } from "./tipos";

/*
 * Importar y exportar CSV. En Flask importar era cosa de admin (con todos los
 * activos) o de quien lidera (con su ambito); aqui igual. Exportar se abre a
 * todos, pero solo con lo que cada uno ya ve en su lista.
 */

export async function puedeImportar(u: UsuarioActual) {
  return u.isAdmin || (await puedeVerEquipo(u));
}

async function personasParaCsv(u: UsuarioActual): Promise<PersonaCsv[]> {
  const ids = await idsUsuariosDelAmbito(u, true);
  const filas = await db.users.findMany({
    where: { is_active: true, ...(ids === "todos" ? {} : { id: { in: ids } }) },
    select: { id: true, username: true, email: true, role: true, area_id: true, areas: { select: { name: true } } },
  });
  return filas.map((p) => ({ id: p.id, username: p.username, email: p.email, area_id: p.area_id, areaNombre: p.areas?.name ?? null, role: p.role }));
}

async function contexto(): Promise<ContextoCsv> {
  return { prioridades: await prioridadesValidas(), prioridadDefecto: await prioridadPorDefecto(), anioActual: Number(hoyNegocio().slice(0, 4)) };
}

export async function vistaPrevia(u: UsuarioActual, archivo: File | null) {
  if (!(await puedeImportar(u))) throw new ErrorApi(403, "Importar tareas es para quien lidera una unidad.");
  if (!archivo || !archivo.name) throw new ErrorApi(400, "Debes seleccionar un archivo CSV.");
  if (archivo.size > 5 * 1024 * 1024) throw new ErrorApi(400, "El archivo pasa de 5 MB. Divídelo en partes.");
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  if (!bytes.length) throw new ErrorApi(400, "El archivo CSV está vacío.");
  const textoCsv = decodificarCsv(bytes);
  if (textoCsv == null) throw new ErrorApi(400, "No se pudo leer el CSV. Usa UTF-8, UTF-16 o CP1252.");
  const r = extraerFilasCsv(textoCsv);
  if ("fallo" in r) throw new ErrorApi(400, r.fallo.error, { details: r.fallo.details });
  return vistaPreviaCsv(r.filas, await personasParaCsv(u), await contexto());
}

/* Guarda las filas validas; las invalidas vuelven para corregirlas. */
export async function importar(u: UsuarioActual, d: Record<string, unknown>) {
  if (!(await puedeImportar(u))) throw new ErrorApi(403, "Importar tareas es para quien lidera una unidad.");
  if (!Array.isArray(d.rows)) throw new ErrorApi(400, "Formato inválido: se esperaba una lista de filas.");
  if (d.rows.length > 5000) throw new ErrorApi(400, "Puedes importar hasta 5000 filas por lote.");

  const filas: FilaCsv[] = [];
  d.rows.forEach((crudo, i) => {
    if (!crudo || typeof crudo !== "object") return;
    const c = crudo as { row_number?: unknown; fields?: unknown };
    const n = Number(c.row_number);
    const entrada = c.fields && typeof c.fields === "object" ? (c.fields as Record<string, unknown>) : {};
    const fields = camposVacios();
    for (const [k] of CAMPOS_CSV) fields[k] = String(entrada[k] ?? "");
    filas.push({ row_number: Number.isInteger(n) ? n : i + 2, fields });
  });

  const personas = await personasParaCsv(u);
  const ctx = await contexto();
  const estado = await estadoInicial();
  const ahora = new Date();
  const restantes: FilaVistaPrevia[] = [];
  const errores: ErrorPlano[] = [];
  const validas: Array<{ fila: FilaCsv; datos: Prisma.tasksCreateManyInput; v: ReturnType<typeof validarFilaCsv> }> = [];

  for (const f of filas) {
    const v = validarFilaCsv(f.fields, personas, ctx);
    if (v.status === "error") {
      restantes.push({ row_number: f.row_number, fields: v.fields, status: v.status, issues: v.issues, parsed: v.preview });
      errores.push(...erroresPlanos(f.row_number, v.issues));
      continue;
    }
    const p = v.parsed;
    const a = p.asignado!;
    validas.push({ fila: f, v, datos: {
      title: v.limpio.title.slice(0, 255), description: v.limpio.description.slice(0, MAX_DESCRIPCION), client: v.limpio.client.slice(0, 100),
      start_date: p.inicio ? diaDb(p.inicio) : null, end_date: p.fin ? diaDb(p.fin) : null,
      directorate: v.limpio.directorate.slice(0, 255), requested_by: v.limpio.requested_by.slice(0, 255),
      budget_type: v.limpio.budget_type.slice(0, 255), due_date: diaDb(p.entrega!), status: estado, priority: p.prioridad,
      // La recurrencia del CSV se valida pero no se expande, como en Flask.
      is_recurrent: false, recurrence_type: null,
      ...areaDe({ role: a.role, area_id: a.area_id, areas: a.areaNombre ? { name: a.areaNombre } : null }),
      creator_id: u.id, assignee_id: a.id, created_at: ahora, updated_at: ahora,
    } });
  }

  let importadas = 0;
  try {
    // Todas de una vez; si la base rechaza el lote, se intenta fila a fila para no perder las buenas.
    importadas = (await db.tasks.createMany({ data: validas.map((x) => x.datos) })).count;
  } catch {
    for (const x of validas) {
      try {
        await db.tasks.create({ data: x.datos as Prisma.tasksUncheckedCreateInput });
        importadas++;
      } catch {
        const issue = { severity: "error" as const, column: "General", code: "db_error", message: "No se pudo guardar la fila por un error de base de datos.", value: "" };
        restantes.push({ row_number: x.fila.row_number, fields: x.v.fields, status: "error", issues: [...x.v.issues, issue], parsed: x.v.preview });
        errores.push({ row: x.fila.row_number, column: "General", value: "", code: "db_error", message: issue.message });
      }
    }
  }

  await registrarActividad(u.id, "task_csv_import", `Importación CSV tareas: filas=${filas.length}, importadas=${importadas}, fallidas=${filas.length - importadas}, tareas_creadas=${importadas}`);
  return { total_rows: filas.length, imported_rows: importadas, failed_rows: filas.length - importadas, created_tasks: importadas, errors: errores, remaining_rows: restantes };
}

/* Lo que la persona ve en su lista (con sus filtros), con las columnas del formato de Flask. */
export async function exportar(u: UsuarioActual, f: Filtros) {
  const finales = await estadosFinales();
  const hoy = hoyNegocio();
  const filas = await db.tasks.findMany({
    where: { AND: [await filtroTareasVisibles(u), ...(await condicionesFiltro(u, f, hoy, finales))] },
    orderBy: { due_date: "desc" },
    take: 10_000,
    include: { asignado: { select: { username: true } } },
  });
  const defecto = await prioridadPorDefecto();
  const iso = (d: Date | null) => (d ? formatoMdy(d.toISOString().slice(0, 10)) : "");
  return escribirCsv([
    [...COLUMNAS_CSV],
    ...filas.map((t) => [
      iso(t.start_date), iso(t.end_date), iso(t.due_date), t.directorate ?? "", t.client ?? "", t.title ?? "",
      t.requested_by ?? "", t.asignado.username, t.description ?? "", t.budget_type ?? "", t.priority || defecto,
      t.is_recurrent && t.recurrence_type ? t.recurrence_type : "No",
    ].map(neutralizarFormula)),
  ]);
}

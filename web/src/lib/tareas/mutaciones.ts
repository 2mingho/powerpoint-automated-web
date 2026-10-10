import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { estadoInicial, estadosFinales, estadosValidos, prioridadesValidas, prioridadPorDefecto } from "@/lib/catalogo";
import type { UsuarioActual } from "@/lib/auth/session";
import { filtroTareasVisibles, puedeAsignarA } from "@/lib/tareas/alcance";
import { notificarVarios } from "@/lib/notificaciones";
import { aDTOs, areaDe, descripcion, diaDb, enlaceTarea, filtroVisiblesYObservadas, INCLUIR_TAREA, MAX_FILAS, tareaEditable, texto, type TareaFila } from "./base";
import { avisarAsignacion, avisarCambioDeEstado, avisarRevision } from "./avisos";
import { esFinDeSemana, generarFechasRecurrencia, parsearFechaEntrada, TIPOS_RECURRENCIA } from "./fechas";
import { colocar, compararColumna } from "./posiciones";
import { resolverCliente } from "@/lib/clientes/resolver";
import { esEstadoDeRevision } from "@/lib/seguimiento/estado";
import { camposDeSeguimiento, efectosDeCambio, exigirPuedeCerrar } from "./seguimiento";

/*
 * Altas, cambios, borrados, operaciones masivas y movimientos del tablero.
 * Reglas de blueprints/tasks.py y tasks_tablero.py; las diferencias con Flask
 * estan comentadas donde ocurren.
 */

const MENSAJE_CONFLICTO = "La tarea fue modificada por otro usuario. Recarga e intenta de nuevo.";

async function asignadoValido(u: UsuarioActual, crudo: unknown) {
  const id = Number(crudo);
  const asignado = Number.isInteger(id) && id > 0
    ? await db.users.findUnique({ where: { id }, select: { id: true, username: true, role: true, area_id: true, is_active: true, areas: { select: { name: true } } } })
    : null;
  if (!asignado) throw new ErrorApi(400, "El usuario asignado no existe.");
  if (!(await puedeAsignarA(u, asignado))) throw new ErrorApi(400, "Solo puedes asignar tareas a usuarios de tu unidad.");
  return asignado;
}

function fechaOpcional(crudo: unknown, mensaje: string): string | null {
  if (!texto(crudo)) return null;
  const f = parsearFechaEntrada(crudo);
  if (!f) throw new ErrorApi(400, mensaje);
  return f;
}

/* ─── Alta (con expansion de recurrencia) ─── */
export async function crearTarea(u: UsuarioActual, d: Record<string, unknown>) {
  const titulo = texto(d.title).slice(0, 255);
  if (!titulo) throw new ErrorApi(400, "El título es obligatorio.");
  const estado = texto(d.status) || (await estadoInicial());
  const prioridad = texto(d.priority) || (await prioridadPorDefecto());
  if (!(await estadosValidos()).includes(estado)) throw new ErrorApi(400, "Estado inválido.");
  if (!(await prioridadesValidas()).includes(prioridad)) throw new ErrorApi(400, "Prioridad inválida.");
  if (!d.assignee_id) throw new ErrorApi(400, "Debes asignar la tarea a alguien.");
  if (!texto(d.due_date)) throw new ErrorApi(400, "La fecha de entrega es obligatoria.");
  const entrega = parsearFechaEntrada(d.due_date);
  if (!entrega) throw new ErrorApi(400, "Fecha de entrega inválida.");
  const inicio = fechaOpcional(d.start_date, "Fecha de inicio inválida.");
  let fin = fechaOpcional(d.end_date, "Fecha de finalización inválida.");
  if (inicio && fin && fin < inicio) throw new ErrorApi(400, "La fecha de finalización no puede ser menor que la fecha de inicio.");

  const asignado = await asignadoValido(u, d.assignee_id);
  const { area, area_id } = areaDe(asignado);
  const seguimiento = await camposDeSeguimiento(u, d, null, asignado.id);
  const finales = await estadosFinales();
  const nace = finales.includes(estado);
  // Una tarea que nace cerrada (rara) tampoco se salta al revisor.
  if (nace) await exigirPuedeCerrar(u, [{ reviewer_id: seguimiento.reviewer_id ?? null }]);
  const recurrente = !!d.is_recurrent;
  const tipo = texto(d.recurrence_type);
  const finSerieCrudo = texto(d.recurrence_end) || texto(d.end_date);

  let fechas = [entrega];
  if (recurrente) {
    if (!(TIPOS_RECURRENCIA as readonly string[]).includes(tipo)) throw new ErrorApi(400, "Selecciona una frecuencia de recurrencia válida.");
    if (esFinDeSemana(entrega)) throw new ErrorApi(400, "Las tareas recurrentes no pueden iniciar en sábado o domingo.");
    if (!finSerieCrudo) throw new ErrorApi(400, "Debes indicar la fecha de finalización para la recurrencia.");
    const finSerie = parsearFechaEntrada(finSerieCrudo);
    if (!finSerie) throw new ErrorApi(400, "Fecha fin de recurrencia inválida.");
    if (finSerie < entrega) throw new ErrorApi(400, "La fecha final de recurrencia no puede ser menor que la fecha de entrega.");
    fin = finSerie;
    fechas = generarFechasRecurrencia(entrega, tipo, finSerie);
    if (!fechas.length) throw new ErrorApi(400, "No se pudieron generar fechas laborables para la recurrencia.");
    if (fechas.length > 365) throw new ErrorApi(400, "La recurrencia genera demasiadas tareas (máx. 365).");
  }

  const ahora = new Date();
  const comun = {
    title: titulo,
    description: descripcion(d.description),
    ...(await resolverCliente(db, d.client)),
    start_date: inicio ? diaDb(inicio) : null,
    end_date: fin ? diaDb(fin) : null,
    directorate: texto(d.directorate).slice(0, 255),
    requested_by: texto(d.requested_by).slice(0, 255),
    budget_type: texto(d.budget_type).slice(0, 255),
    status: estado,
    priority: prioridad,
    is_recurrent: recurrente,
    recurrence_type: recurrente ? tipo : null,
    area, area_id,
    creator_id: u.id,
    assignee_id: asignado.id,
    created_at: ahora,
    updated_at: ahora,
    ...seguimiento,
    ...(nace ? { done_at: ahora, block_reason: null } : {}),
  };

  const primera = await db.$transaction(async (tx) => {
    const padre = await tx.tasks.create({ data: { ...comun, due_date: diaDb(fechas[0]) }, include: INCLUIR_TAREA });
    if (fechas.length > 1) {
      await tx.tasks.createMany({ data: fechas.slice(1).map((f) => ({ ...comun, due_date: diaDb(f), parent_task_id: padre.id })) });
    }
    // Flask notificaba con link '/tasks?task=None' antes de tener id; aqui ya lo tiene.
    await avisarAsignacion("task_assigned", asignado.id, padre, u.id, tx);
    return padre;
  });

  await registrarActividad(u.id, "task_create", `Tarea creada: ${titulo} (${fechas.length} instancia(s))`, { tipo: "task", id: primera.id });
  return { tarea: (await aDTOs([primera], u.id))[0], cuantas: fechas.length };
}

/* ─── Cambio de una tarea (PUT) ─── */
export async function actualizarTarea(u: UsuarioActual, id: number, d: Record<string, unknown>) {
  const previa = await tareaEditable(u, id);
  const datos: Prisma.tasksUncheckedUpdateInput = {};

  if ("title" in d) datos.title = texto(d.title).slice(0, 255) || previa.title;
  if ("description" in d) datos.description = descripcion(d.description);
  if ("client" in d) Object.assign(datos, await resolverCliente(db, d.client));
  if ("directorate" in d) datos.directorate = texto(d.directorate).slice(0, 255);
  if ("requested_by" in d) datos.requested_by = texto(d.requested_by).slice(0, 255);
  if ("budget_type" in d) datos.budget_type = texto(d.budget_type).slice(0, 255);
  let inicio = previa.start_date?.toISOString().slice(0, 10) ?? null;
  let fin = previa.end_date?.toISOString().slice(0, 10) ?? null;
  if ("start_date" in d) { inicio = fechaOpcional(d.start_date, "Fecha de inicio inválida."); datos.start_date = inicio ? diaDb(inicio) : null; }
  if ("end_date" in d) { fin = fechaOpcional(d.end_date, "Fecha de finalización inválida."); datos.end_date = fin ? diaDb(fin) : null; }
  if (inicio && fin && fin < inicio) throw new ErrorApi(400, "La fecha de finalización no puede ser menor que la fecha de inicio.");

  let cambiaEstado = false;
  if ("status" in d) {
    // Flask ignoraba en silencio un estado desconocido; aqui es un 400 como la prioridad.
    if (!(await estadosValidos()).includes(String(d.status))) throw new ErrorApi(400, "Estado inválido.");
    cambiaEstado = d.status !== previa.status;
    datos.status = String(d.status);
  }
  if ("priority" in d) {
    if (!(await prioridadesValidas()).includes(String(d.priority))) throw new ErrorApi(400, "Prioridad inválida.");
    datos.priority = String(d.priority);
  }
  if ("due_date" in d) {
    const f = parsearFechaEntrada(d.due_date);
    if (!f) throw new ErrorApi(400, "Fecha de entrega inválida.");
    datos.due_date = diaDb(f);
  }
  let reasignada: number | null = null;
  if ("assignee_id" in d) {
    const asignado = await asignadoValido(u, d.assignee_id);
    datos.assignee_id = asignado.id;
    Object.assign(datos, areaDe(asignado));
    if (asignado.id !== previa.assignee_id) reasignada = asignado.id;
  }

  const seguimiento = await camposDeSeguimiento(u, d, previa, (datos.assignee_id as number | undefined) ?? previa.assignee_id);
  Object.assign(datos, seguimiento);
  if (cambiaEstado) {
    const finales = await estadosFinales();
    const previoFinal = finales.includes(previa.status);
    const nuevoFinal = finales.includes(String(datos.status));
    if (!previoFinal && nuevoFinal) {
      const revisorFinal = "reviewer_id" in seguimiento ? seguimiento.reviewer_id ?? null : previa.reviewer_id;
      await exigirPuedeCerrar(u, [{ reviewer_id: revisorFinal }], revisorFinal === previa.reviewer_id ? previa.revisor?.username : undefined);
    }
    // Despues de seguimiento: cerrar borra el motivo de bloqueo aunque venga en el mismo cuerpo.
    Object.assign(datos, efectosDeCambio(previoFinal, nuevoFinal));
  }

  const esperado = texto(d.expected_updated_at);
  const tarea = await db.$transaction(async (tx) => {
    // Bloquea la fila: entre leer la version y escribir nadie mas la toca.
    const filas = await tx.$queryRaw<Array<{ updated_at: Date | null }>>`SELECT updated_at FROM tasks WHERE id = ${id} FOR UPDATE`;
    const actual = filas[0]?.updated_at?.toISOString() ?? "";
    if (esperado && esperado !== actual) {
      const vigente = await tx.tasks.findUniqueOrThrow({ where: { id }, include: INCLUIR_TAREA });
      throw new ConflictoTarea(vigente);
    }
    const t = await tx.tasks.update({ where: { id }, data: datos, include: INCLUIR_TAREA });
    if (reasignada) await avisarAsignacion("task_reassigned", reasignada, t, u.id, tx);
    if (cambiaEstado) await avisarCambioDeEstado(t, u.id, tx);
    if (cambiaEstado && esEstadoDeRevision(t.status)) await avisarRevision(t, u.id, tx);
    return t;
  }).catch(async (e) => {
    if (e instanceof ConflictoTarea) throw new ErrorApi(409, MENSAJE_CONFLICTO, { tarea: (await aDTOs([e.tarea], u.id))[0] });
    throw e;
  });

  await registrarActividad(u.id, "task_update", `Tarea actualizada: ${tarea.title} (id=${tarea.id})`, { tipo: "task", id: tarea.id });
  return (await aDTOs([tarea], u.id))[0];
}

class ConflictoTarea extends Error {
  constructor(public tarea: TareaFila) { super("conflicto"); }
}

/* ─── Borrado suave, con serie opcional ─── */
export async function borrarTarea(u: UsuarioActual, id: number, serie: boolean) {
  const t = await tareaEditable(u, id);
  const ahora = new Date();
  let cuantas = 1;
  // Solo las hijas que puede editar: una reasignada a otra unidad ya no es suya.
  const editables = await filtroTareasVisibles(u);
  await db.$transaction(async (tx) => {
    // Solo desde la tarea madre se borra la serie, como en Flask.
    if (serie && t.parent_task_id == null) {
      const r = await tx.tasks.updateMany({ where: { AND: [editables, { parent_task_id: t.id, deleted_at: null }] }, data: { deleted_at: ahora, deleted_by_id: u.id } });
      cuantas += r.count;
    }
    await tx.tasks.update({ where: { id: t.id }, data: { deleted_at: ahora, deleted_by_id: u.id } });
  });
  await registrarActividad(u.id, "task_delete", `Tarea eliminada: ${t.title} (${cuantas} instancia(s))`, { tipo: "task", id: t.id });
  return cuantas;
}

/* Deshacer un borrado reciente: solo lo que borro esta misma persona. */
export async function restaurarTarea(u: UsuarioActual, id: number) {
  const t = await db.tasks.findFirst({ where: { id, deleted_by_id: u.id, deleted_at: { not: null } }, select: { id: true, deleted_at: true, title: true } });
  if (!t) throw new ErrorApi(404, "No hay nada que restaurar.");
  const r = await db.tasks.updateMany({ where: { deleted_at: t.deleted_at, deleted_by_id: u.id, OR: [{ id: t.id }, { parent_task_id: t.id }] }, data: { deleted_at: null, deleted_by_id: null } });
  await registrarActividad(u.id, "task_restore", `Tarea restaurada: ${t.title} (${r.count} instancia(s))`, { tipo: "task", id: t.id });
  return r.count;
}

function idsDe(crudos: unknown): number[] {
  if (!Array.isArray(crudos)) return [];
  const vistos = new Set<number>();
  for (const c of crudos) {
    const n = Number(c);
    if (Number.isInteger(n) && n > 0) vistos.add(n);
  }
  return [...vistos];
}

/* ─── Operaciones masivas: estado, prioridad, fechas o borrado ─── */
export async function operacionMasiva(u: UsuarioActual, d: Record<string, unknown>) {
  const accion = texto(d.accion);
  const mapa = d.due_date_map && typeof d.due_date_map === "object" && !Array.isArray(d.due_date_map) ? (d.due_date_map as Record<string, unknown>) : null;
  const ids = mapa ? idsDe(Object.keys(mapa)) : idsDe(d.task_ids);
  if (!ids.length) throw new ErrorApi(400, "Debes seleccionar al menos una tarea.");
  if (ids.length > MAX_FILAS) throw new ErrorApi(400, "Puedes editar hasta 500 tareas por lote.");

  const visibles = await db.tasks.findMany({
    where: { AND: [await filtroTareasVisibles(u), { id: { in: ids } }] },
    select: { id: true, title: true, status: true, reviewer_id: true },
  });
  if (!visibles.length) throw new ErrorApi(404, "No se encontraron tareas para editar.");
  const encontradas = visibles.map((t) => t.id);
  const ahora = new Date();

  if (accion === "borrar") {
    await db.tasks.updateMany({ where: { id: { in: encontradas } }, data: { deleted_at: ahora, deleted_by_id: u.id } });
    await registrarActividad(u.id, "task_bulk_delete_user", `Eliminación masiva (usuario) de ${encontradas.length} tarea(s). ids=[${encontradas.join(", ")}]`);
    return { afectadas: encontradas.length };
  }

  const estado = texto(d.status);
  const prioridad = texto(d.priority);
  if (estado && !(await estadosValidos()).includes(estado)) throw new ErrorApi(400, "Estado inválido.");
  if (prioridad && !(await prioridadesValidas()).includes(prioridad)) throw new ErrorApi(400, "Prioridad inválida.");
  const fechas = new Map<number, string>();
  if (mapa) {
    for (const [k, v] of Object.entries(mapa)) {
      const f = parsearFechaEntrada(v);
      if (!f) throw new ErrorApi(400, "Fecha inválida en movimiento masivo.");
      fechas.set(Number(k), f);
    }
  }
  if (!estado && !prioridad && !fechas.size) throw new ErrorApi(400, "No hay cambios para aplicar.");

  const finales = await estadosFinales();
  const cierran = estado && finales.includes(estado) ? visibles.filter((t) => !finales.includes(t.status)) : [];
  const reabren = estado && !finales.includes(estado) ? visibles.filter((t) => finales.includes(t.status)) : [];
  if (cierran.length) await exigirPuedeCerrar(u, cierran);

  await db.$transaction(async (tx) => {
    if (estado || prioridad) {
      await tx.tasks.updateMany({ where: { id: { in: encontradas } }, data: { ...(estado ? { status: estado } : {}), ...(prioridad ? { priority: prioridad } : {}), updated_at: ahora } });
    }
    // done_at solo cambia en las que cruzan la frontera abierta/cerrada.
    if (cierran.length) await tx.tasks.updateMany({ where: { id: { in: cierran.map((t) => t.id) } }, data: { done_at: ahora, block_reason: null } });
    if (reabren.length) await tx.tasks.updateMany({ where: { id: { in: reabren.map((t) => t.id) } }, data: { done_at: null } });
    // Una escritura por fecha distinta, no por tarea.
    const porFecha = new Map<string, number[]>();
    for (const [id, f] of fechas) if (encontradas.includes(id)) porFecha.set(f, [...(porFecha.get(f) ?? []), id]);
    for (const [f, lista] of porFecha) {
      await tx.tasks.updateMany({ where: { id: { in: lista } }, data: { due_date: diaDb(f), updated_at: ahora } });
    }
    // Flask no avisaba a los observadores en el cambio masivo; el formulario y el tablero si.
    if (estado) {
      const cambian = visibles.filter((t) => t.status !== estado);
      // Cada tarea que llega a revision avisa a su revisor.
      if (esEstadoDeRevision(estado) && cambian.length) {
        for (const r of await tx.tasks.findMany({ where: { id: { in: cambian.map((t) => t.id) }, reviewer_id: { not: null } }, select: { id: true, title: true, reviewer_id: true } })) {
          await avisarRevision(r, u.id, tx);
        }
      }
      const obs = await tx.task_watchers.findMany({ where: { task_id: { in: cambian.map((t) => t.id) } }, select: { task_id: true, user_id: true } });
      for (const t of cambian) {
        await notificarVarios(obs.filter((o) => o.task_id === t.id).map((o) => o.user_id), {
          tipo: "task_watching", titulo: `Estado actualizado en: ${t.title}`, cuerpo: `Nuevo estado: ${estado}`,
          enlace: enlaceTarea(t.id), entidad: { tipo: "task", id: t.id }, actorId: u.id,
        }, tx);
      }
    }
  });
  await registrarActividad(u.id, "task_bulk_update_user", `Actualización masiva (usuario) de ${encontradas.length} tarea(s). ids=[${encontradas.join(", ")}]`);
  return { afectadas: encontradas.length };
}

/* ─── Tablero: cambiar de columna y/o de sitio ─── */
export async function moverTarea(u: UsuarioActual, id: number, d: Record<string, unknown>) {
  const t = await tareaEditable(u, id);
  const estado = texto(d.status) || t.status;
  if (!(await estadosValidos()).includes(estado)) throw new ErrorApi(400, "Estado inválido.");
  const cambiaEstado = estado !== t.status;
  const finalesDestino = await estadosFinales();
  const previoFinal = finalesDestino.includes(t.status);
  const nuevoFinal = finalesDestino.includes(estado);
  if (cambiaEstado && !previoFinal && nuevoFinal) await exigirPuedeCerrar(u, [{ reviewer_id: t.reviewer_id }], t.revisor?.username);
  const esperado = texto(d.expected_updated_at);
  const aId = (v: unknown) => { const n = Number(v); return v != null && v !== "" && Number.isInteger(n) ? n : null; };

  // La columna de destino, en el orden que pinta el tablero y dentro del alcance.
  const visibles = await filtroVisiblesYObservadas(u);
  const columna = (await db.tasks.findMany({
    where: { AND: [await filtroTareasVisibles(u), { status: estado, id: { not: t.id } }] },
    select: { id: true, board_position: true, due_date: true },
  })).map((x) => ({ id: x.id, posicion: x.board_position, entrega: x.due_date.toISOString().slice(0, 10) })).sort(compararColumna);
  const { posicion, otras } = colocar(columna, t.id, aId(d.anterior_id), aId(d.siguiente_id));

  let aviso = "";
  const finales = await estadosFinales();
  const movida = await db.$transaction(async (tx) => {
    if (cambiaEstado) {
      // El conflicto solo importa si cambia el estado: reordenar no pisa lo que otro edita.
      const filas = await tx.$queryRaw<Array<{ updated_at: Date | null }>>`SELECT updated_at FROM tasks WHERE id = ${t.id} FOR UPDATE`;
      const actual = filas[0]?.updated_at?.toISOString() ?? "";
      if (esperado && esperado !== actual) throw new ConflictoTarea(await tx.tasks.findUniqueOrThrow({ where: { id: t.id }, include: INCLUIR_TAREA }));
      await tx.tasks.update({ where: { id: t.id }, data: { status: estado, board_position: posicion, ...efectosDeCambio(previoFinal, nuevoFinal) } });
      if (finales.includes(estado)) {
        const abiertas: Prisma.tasksWhereInput = { deleted_at: null, status: { notIn: finales }, bloquea_a: { some: { blocked_task_id: t.id } } };
        // Las bloqueadoras de otra unidad se cuentan, pero su titulo no sale: no se pueden ver.
        const [pendientes, total] = await Promise.all([
          tx.tasks.findMany({ where: { AND: [abiertas, visibles] }, select: { title: true }, orderBy: { due_date: "asc" } }),
          tx.tasks.count({ where: abiertas }),
        ]);
        const ocultas = total - pendientes.length;
        if (total) {
          // No se impide: quien cierra sabe si la dependencia sigue en pie. Pero se dice.
          const resto = pendientes.length - 3;
          const nombres = pendientes.slice(0, 3).map((p) => p.title).join(", ");
          const mas = resto > 0 ? ` y ${resto} más` : "";
          const fuera = ocultas ? `${pendientes.length ? " y " : ""}${ocultas} que no puedes ver` : "";
          aviso = `Sigue bloqueada por: ${nombres}${mas}${fuera}.`;
        }
      }
      await avisarCambioDeEstado({ id: t.id, title: t.title, status: estado }, u.id, tx);
      if (esEstadoDeRevision(estado)) await avisarRevision({ id: t.id, title: t.title, reviewer_id: t.reviewer_id }, u.id, tx);
    } else {
      // UPDATE directo: reordenar no es editar y no toca updated_at.
      await tx.$executeRaw`UPDATE tasks SET board_position = ${posicion} WHERE id = ${t.id}`;
    }
    if (otras.length) {
      await tx.$executeRaw`UPDATE tasks AS t SET board_position = v.pos
        FROM (SELECT unnest(${otras.map((o) => o[0])}::int[]) AS id, unnest(${otras.map((o) => o[1])}::float8[]) AS pos) AS v
        WHERE t.id = v.id`;
    }
    return tx.tasks.findUniqueOrThrow({ where: { id: t.id }, include: INCLUIR_TAREA });
  }).catch(async (e) => {
    if (e instanceof ConflictoTarea) throw new ErrorApi(409, MENSAJE_CONFLICTO, { tarea: (await aDTOs([e.tarea], u.id))[0] });
    throw e;
  });

  if (cambiaEstado) {
    await registrarActividad(u.id, "task_update", `Tarea movida en el tablero: ${t.title} (${t.status} → ${estado}) (id=${t.id})`, { tipo: "task", id: t.id });
  }
  return { tarea: (await aDTOs([movida], u.id))[0], aviso };
}

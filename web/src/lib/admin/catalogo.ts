import "server-only";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { invalidarCatalogo } from "@/lib/catalogo";
import { esDuplicado, texto, tono } from "./api";

/*
 * Catalogo de estados y prioridades (catalogo_* de admin.py). Las guardas
 * existen porque romperlas deja el sistema en un estado imposible:
 *   - sin estado final nada cuenta como terminado (vencidas, carga, indicadores);
 *   - sin estado inicial no se puede crear una tarea (Flask no lo protegia);
 *   - sin prioridad por defecto los formularios eligen una al azar.
 * La tarea guarda el nombre, no una clave: renombrar reescribe las tareas en
 * la misma transaccion.
 *
 * tasks.priority es VARCHAR(10): una prioridad de mas de 10 caracteres hacia
 * fallar el renombrado en Flask. Aqui se limita el nombre a 10.
 */
export const MAX_NOMBRE_ESTADO = 30;
export const MAX_NOMBRE_PRIORIDAD = 10;

type DatosEstado = { nombre?: unknown; color?: unknown; esInicial?: unknown; esFinal?: unknown };

async function crearEstadoInterno(d: DatosEstado) {
  const nombre = texto(d.nombre, MAX_NOMBRE_ESTADO);
  if (!nombre) throw new ErrorApi(400, "El nombre es obligatorio.");
  const esInicial = d.esInicial === true;
  const esFinal = d.esFinal === true;
  try {
    return await db.$transaction(async (tx) => {
      if (await tx.task_statuses.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" } } })) {
        throw new ErrorApi(409, `Ya existe un estado llamado "${nombre}".`);
      }
      const max = await tx.task_statuses.aggregate({ _max: { orden: true } });
      const e = await tx.task_statuses.create({
        data: { nombre, color: tono(d.color), orden: (max._max.orden ?? 0) + 10, es_inicial: esInicial, es_final: esFinal },
      });
      if (esInicial) await tx.task_statuses.updateMany({ where: { NOT: { id: e.id } }, data: { es_inicial: false } });
      return { estado: e, mensaje: `Estado "${nombre}" creado.` };
    });
  } catch (e) {
    if (esDuplicado(e)) throw new ErrorApi(409, `Ya existe un estado llamado "${nombre}".`);
    throw e;
  }
}

async function editarEstadoInterno(id: number, d: DatosEstado) {
  return db.$transaction(async (tx) => {
    const e = await tx.task_statuses.findUnique({ where: { id } });
    if (!e) throw new ErrorApi(404, "Estado no encontrado.");
    const nombre = "nombre" in d ? texto(d.nombre, MAX_NOMBRE_ESTADO) : e.nombre;
    if (!nombre) throw new ErrorApi(400, "El nombre es obligatorio.");
    const esFinal = "esFinal" in d ? d.esFinal === true : e.es_final;
    const esInicial = "esInicial" in d ? d.esInicial === true : e.es_inicial;
    const color = "color" in d ? tono(d.color) : e.color;

    if (nombre !== e.nombre && await tx.task_statuses.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" }, NOT: { id } } })) {
      throw new ErrorApi(409, `Ya existe un estado llamado "${nombre}".`);
    }
    if (e.es_final && !esFinal && (await tx.task_statuses.count({ where: { es_final: true, NOT: { id } } })) === 0) {
      throw new ErrorApi(409, 'Tiene que quedar al menos un estado que signifique "terminado".');
    }
    if (e.es_inicial && !esInicial) {
      throw new ErrorApi(409, "Tiene que quedar un estado inicial: marca otro como inicial y este dejará de serlo.");
    }

    await tx.task_statuses.update({ where: { id }, data: { nombre, color, es_final: esFinal, es_inicial: esInicial } });
    if (esInicial) await tx.task_statuses.updateMany({ where: { NOT: { id } }, data: { es_inicial: false } });

    let movidas = 0;
    if (nombre !== e.nombre) {
      movidas = (await tx.tasks.updateMany({ where: { status: e.nombre }, data: { status: nombre } })).count;
    }
    const mensaje = `Estado "${nombre}" actualizado.${movidas ? ` Se renombraron ${movidas} tarea(s).` : ""}`;
    return { movidas, mensaje, anterior: e.nombre };
  });
}

async function eliminarEstadoInterno(id: number) {
  return db.$transaction(async (tx) => {
    const e = await tx.task_statuses.findUnique({ where: { id } });
    if (!e) throw new ErrorApi(404, "Estado no encontrado.");
    const enUso = await tx.tasks.count({ where: { status: e.nombre } });
    if (enUso) throw new ErrorApi(409, `No se puede eliminar: ${enUso} tarea(s) están en "${e.nombre}". Muévelas antes de quitarlo.`);
    if (e.es_final && (await tx.task_statuses.count({ where: { es_final: true, NOT: { id } } })) === 0) {
      throw new ErrorApi(409, 'Es el único estado que significa "terminado": no se puede eliminar.');
    }
    if (e.es_inicial) throw new ErrorApi(409, "Es el estado inicial: marca otro como inicial antes de eliminarlo.");
    if ((await tx.task_statuses.count()) <= 1) throw new ErrorApi(409, "Tiene que quedar al menos un estado.");
    await tx.task_statuses.delete({ where: { id } });
    return e.nombre;
  });
}

/* Orden visual = orden de la lista; se guarda en pasos de 10 para dejar hueco. */
async function reordenarInterno(tabla: "estados" | "prioridades", ids: unknown) {
  if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x))) throw new ErrorApi(400, "Orden inválido.");
  const lista = ids as number[];
  return db.$transaction(async (tx) => {
    const existentes = tabla === "estados"
      ? await tx.task_statuses.findMany({ select: { id: true } })
      : await tx.task_priorities.findMany({ select: { id: true } });
    const todos = new Set(existentes.map((x) => x.id));
    if (lista.length !== todos.size || new Set(lista).size !== lista.length || !lista.every((x) => todos.has(x))) {
      throw new ErrorApi(409, "El catálogo cambió mientras lo ordenabas. Recarga y vuelve a intentarlo.");
    }
    for (const [i, id] of lista.entries()) {
      // Prioridades: la primera de la lista es la mas importante (orden mayor).
      const orden = tabla === "estados" ? (i + 1) * 10 : (lista.length - i) * 10;
      if (tabla === "estados") await tx.task_statuses.update({ where: { id }, data: { orden } });
      else await tx.task_priorities.update({ where: { id }, data: { orden } });
    }
    return lista.length;
  });
}

type DatosPrioridad = { nombre?: unknown; color?: unknown; esDefecto?: unknown };

async function crearPrioridadInterno(d: DatosPrioridad) {
  const nombre = texto(d.nombre, MAX_NOMBRE_PRIORIDAD);
  if (!nombre) throw new ErrorApi(400, "El nombre es obligatorio.");
  const esDefecto = d.esDefecto === true;
  try {
    return await db.$transaction(async (tx) => {
      if (await tx.task_priorities.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" } } })) {
        throw new ErrorApi(409, `Ya existe una prioridad llamada "${nombre}".`);
      }
      const min = await tx.task_priorities.aggregate({ _min: { orden: true } });
      const p = await tx.task_priorities.create({
        data: { nombre, color: tono(d.color), orden: Math.max(0, (min._min.orden ?? 10) - 5), es_defecto: esDefecto },
      });
      if (esDefecto) await tx.task_priorities.updateMany({ where: { NOT: { id: p.id } }, data: { es_defecto: false } });
      return { prioridad: p, mensaje: `Prioridad "${nombre}" creada.` };
    });
  } catch (e) {
    if (esDuplicado(e)) throw new ErrorApi(409, `Ya existe una prioridad llamada "${nombre}".`);
    throw e;
  }
}

async function editarPrioridadInterno(id: number, d: DatosPrioridad) {
  return db.$transaction(async (tx) => {
    const p = await tx.task_priorities.findUnique({ where: { id } });
    if (!p) throw new ErrorApi(404, "Prioridad no encontrada.");
    const nombre = "nombre" in d ? texto(d.nombre, MAX_NOMBRE_PRIORIDAD) : p.nombre;
    if (!nombre) throw new ErrorApi(400, "El nombre es obligatorio.");
    const esDefecto = "esDefecto" in d ? d.esDefecto === true : p.es_defecto;
    const color = "color" in d ? tono(d.color) : p.color;
    if (nombre !== p.nombre && await tx.task_priorities.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" }, NOT: { id } } })) {
      throw new ErrorApi(409, `Ya existe una prioridad llamada "${nombre}".`);
    }
    if (p.es_defecto && !esDefecto) {
      throw new ErrorApi(409, "Tiene que quedar una prioridad por defecto: marca otra y esta dejará de serlo.");
    }
    await tx.task_priorities.update({ where: { id }, data: { nombre, color, es_defecto: esDefecto } });
    if (esDefecto) await tx.task_priorities.updateMany({ where: { NOT: { id } }, data: { es_defecto: false } });
    let movidas = 0;
    if (nombre !== p.nombre) movidas = (await tx.tasks.updateMany({ where: { priority: p.nombre }, data: { priority: nombre } })).count;
    return { movidas, mensaje: `Prioridad "${nombre}" actualizada.${movidas ? ` Se renombraron ${movidas} tarea(s).` : ""}` };
  });
}

async function eliminarPrioridadInterno(id: number) {
  return db.$transaction(async (tx) => {
    const p = await tx.task_priorities.findUnique({ where: { id } });
    if (!p) throw new ErrorApi(404, "Prioridad no encontrada.");
    const enUso = await tx.tasks.count({ where: { priority: p.nombre } });
    if (enUso) throw new ErrorApi(409, `No se puede eliminar: ${enUso} tarea(s) tienen prioridad "${p.nombre}".`);
    if (p.es_defecto) throw new ErrorApi(409, "Es la prioridad por defecto: marca otra antes de eliminarla.");
    if ((await tx.task_priorities.count()) <= 1) throw new ErrorApi(409, "Tiene que quedar al menos una prioridad.");
    await tx.task_priorities.delete({ where: { id } });
    return p.nombre;
  });
}

/* crearEstado: tras cualquier cambio del catalogo, se descarta la memoria de lib/catalogo.ts. */
export async function crearEstado(d: DatosEstado) {
  try {
    return await crearEstadoInterno(d);
  } finally {
    invalidarCatalogo();
  }
}

/* editarEstado: tras cualquier cambio del catalogo, se descarta la memoria de lib/catalogo.ts. */
export async function editarEstado(id: number, d: DatosEstado) {
  try {
    return await editarEstadoInterno(id, d);
  } finally {
    invalidarCatalogo();
  }
}

/* eliminarEstado: tras cualquier cambio del catalogo, se descarta la memoria de lib/catalogo.ts. */
export async function eliminarEstado(id: number) {
  try {
    return await eliminarEstadoInterno(id);
  } finally {
    invalidarCatalogo();
  }
}

/* reordenar: tras cualquier cambio del catalogo, se descarta la memoria de lib/catalogo.ts. */
export async function reordenar(tabla: "estados" | "prioridades", ids: unknown) {
  try {
    return await reordenarInterno(tabla, ids);
  } finally {
    invalidarCatalogo();
  }
}

/* crearPrioridad: tras cualquier cambio del catalogo, se descarta la memoria de lib/catalogo.ts. */
export async function crearPrioridad(d: DatosPrioridad) {
  try {
    return await crearPrioridadInterno(d);
  } finally {
    invalidarCatalogo();
  }
}

/* editarPrioridad: tras cualquier cambio del catalogo, se descarta la memoria de lib/catalogo.ts. */
export async function editarPrioridad(id: number, d: DatosPrioridad) {
  try {
    return await editarPrioridadInterno(id, d);
  } finally {
    invalidarCatalogo();
  }
}

/* eliminarPrioridad: tras cualquier cambio del catalogo, se descarta la memoria de lib/catalogo.ts. */
export async function eliminarPrioridad(id: number) {
  try {
    return await eliminarPrioridadInterno(id);
  } finally {
    invalidarCatalogo();
  }
}

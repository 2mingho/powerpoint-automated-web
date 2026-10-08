import "server-only";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { estadosFinales } from "@/lib/catalogo";
import type { UsuarioActual } from "@/lib/auth/session";
import { filtroTareasVisibles, puedeEditarTarea, puedeVerTarea } from "@/lib/tareas/alcance";
import { filtroVisiblesYObservadas, tareaEditable, tareaVisible } from "./base";
import type { DependenciasDTO, RelacionDTO } from "./tipos";

/*
 * Dependencias: blocker va primero, blocked espera. Dirigidas y sin ciclos;
 * eso lo comprueba quien la crea, porque la base no sabe recorrer un grafo.
 */

/* Si "blocker antes que blocked" cerraria un circulo. Una consulta por nivel; tope de 50. */
export async function creariaCiclo(blockerId: number, blockedId: number): Promise<boolean> {
  if (blockerId === blockedId) return true;
  const vistas = new Set([blockedId]);
  let frontera = [blockedId];
  for (let nivel = 0; nivel < 50; nivel++) {
    if (!frontera.length) return false;
    const siguientes = (await db.task_dependencies.findMany({ where: { blocker_task_id: { in: frontera } }, select: { blocked_task_id: true } }))
      .map((f) => f.blocked_task_id);
    if (siguientes.includes(blockerId)) return true;
    frontera = [...new Set(siguientes)].filter((id) => !vistas.has(id));
    frontera.forEach((id) => vistas.add(id));
  }
  // Mas de cincuenta niveles no es una cadena de trabajo: se rechaza por si acaso.
  return true;
}

const SELECT_OTRA = { id: true, title: true, status: true, due_date: true, deleted_at: true, asignado: { select: { username: true } } } as const;

export async function dependencias(u: UsuarioActual, id: number): Promise<DependenciasDTO & { puedeEditar: boolean }> {
  const t = await tareaVisible(u, id);
  const [previas, siguientes] = await Promise.all([
    db.task_dependencies.findMany({ where: { blocked_task_id: t.id }, select: { id: true, bloqueadora: { select: SELECT_OTRA } } }),
    db.task_dependencies.findMany({ where: { blocker_task_id: t.id }, select: { id: true, bloqueada: { select: SELECT_OTRA } } }),
  ]);
  const otras = [...previas.map((p) => p.bloqueadora), ...siguientes.map((s) => s.bloqueada)].filter((o) => !o.deleted_at);
  // Visibilidad de todas en una consulta, no una por relacion.
  const visibles = new Set((await db.tasks.findMany({
    where: { AND: [await filtroVisiblesYObservadas(u), { id: { in: otras.map((o) => o.id) } }] },
    select: { id: true },
  })).map((x) => x.id));
  const finales = await estadosFinales();

  const lado = (filas: Array<{ id: number; otra: (typeof otras)[number] }>) => {
    const vis: RelacionDTO[] = [];
    let ocultas = 0;
    for (const { id: depId, otra } of filas) {
      if (otra.deleted_at) continue;
      if (!visibles.has(otra.id)) { ocultas++; continue; }
      vis.push({
        id: otra.id, titulo: otra.title, estado: otra.status, entrega: otra.due_date.toISOString().slice(0, 10),
        asignado: otra.asignado.username, cerrada: finales.includes(otra.status), dependenciaId: depId,
      });
    }
    return { vis, ocultas };
  };
  const a = lado(previas.map((p) => ({ id: p.id, otra: p.bloqueadora })));
  const b = lado(siguientes.map((s) => ({ id: s.id, otra: s.bloqueada })));
  // Se dice cuantas no se ven: si no, una tarea parada por otra unidad pareceria libre.
  return { bloqueadaPor: a.vis, bloquea: b.vis, ocultasBloqueadaPor: a.ocultas, ocultasBloquea: b.ocultas, puedeEditar: await puedeEditarTarea(u, t) };
}

export async function crearDependencia(u: UsuarioActual, id: number, d: Record<string, unknown>) {
  const t = await tareaEditable(u, id);
  const tipo = d.tipo;
  if (tipo !== "blocked_by" && tipo !== "blocks") throw new ErrorApi(400, "Tipo de relación inválido.");
  const otraId = Number(d.task_id);
  if (!Number.isInteger(otraId) || otraId <= 0) throw new ErrorApi(400, "Falta la otra tarea.");
  const otra = await db.tasks.findFirst({ where: { id: otraId, deleted_at: null }, select: { id: true, title: true, area_id: true, assignee_id: true, visibility: true } });
  if (!otra || !(await puedeVerTarea(u, otra))) throw new ErrorApi(404, "La otra tarea no existe o no la puedes ver.");
  if (otra.id === t.id) throw new ErrorApi(400, "Una tarea no puede depender de sí misma.");

  const [blocker, blocked] = tipo === "blocked_by" ? [otra.id, t.id] : [t.id, otra.id];
  if (await db.task_dependencies.findFirst({ where: { blocker_task_id: blocker, blocked_task_id: blocked }, select: { id: true } })) {
    throw new ErrorApi(409, "Esa relación ya existe.");
  }
  if (await creariaCiclo(blocker, blocked)) throw new ErrorApi(400, "Eso crearía un círculo: una de las dos ya depende de la otra.");

  const rel = await db.task_dependencies.create({ data: { blocker_task_id: blocker, blocked_task_id: blocked, created_by_id: u.id, created_at: new Date() } });
  const texto = tipo === "blocked_by" ? `"${otra.title}" debe cerrarse antes que "${t.title}"` : `"${t.title}" debe cerrarse antes que "${otra.title}"`;
  await registrarActividad(u.id, "task_dependency_add", `Dependencia: ${texto}`, { tipo: "task", id: t.id });
  return rel.id;
}

export async function borrarDependencia(u: UsuarioActual, id: number, depId: number) {
  const t = await tareaEditable(u, id);
  const rel = await db.task_dependencies.findFirst({
    where: { id: depId, OR: [{ blocker_task_id: t.id }, { blocked_task_id: t.id }] },
    select: { id: true, bloqueadora: { select: { title: true } }, bloqueada: { select: { title: true } } },
  });
  if (!rel) throw new ErrorApi(404, "Esa relación no existe.");
  await db.task_dependencies.delete({ where: { id: rel.id } });
  await registrarActividad(u.id, "task_dependency_remove", `Dependencia quitada: "${rel.bloqueadora.title}" ya no va antes que "${rel.bloqueada.title}"`, { tipo: "task", id: t.id });
}

/* Para el buscador del pase: tareas visibles que podrian relacionarse. */
export async function buscarRelacionables(u: UsuarioActual, id: number, q: string) {
  const t = await tareaVisible(u, id);
  const filas = await db.tasks.findMany({
    where: { AND: [await filtroTareasVisibles(u), { id: { not: t.id } }, ...(q.length >= 2 ? [{ title: { contains: q, mode: "insensitive" as const } }] : [])] },
    orderBy: { due_date: "asc" },
    take: 12,
    select: { id: true, title: true, status: true, due_date: true },
  });
  return filas.map((f) => ({ id: f.id, titulo: f.title, estado: f.status, entrega: f.due_date.toISOString().slice(0, 10) }));
}

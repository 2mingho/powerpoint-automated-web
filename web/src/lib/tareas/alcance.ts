import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ambitoUnidades } from "@/lib/alcance";
import { porObjeto } from "@/lib/memo";
import type { UsuarioActual } from "@/lib/auth/session";

/*
 * Reglas de visibilidad de tareas (blueprints/tasks.py). Todo lo que liste,
 * cuente o edite tareas pasa por aqui; ninguna pantalla decide por su cuenta.
 *
 *   ver    admin, o tarea de su ambito (por unidad o por persona asignada),
 *          o tarea 'shared' que observa
 *   editar admin, o tarea de su ambito
 *
 * Sin unidades en el ambito, solo el propio usuario: cierra en falso.
 */

/* Usuarios con los que trabaja (su ambito); sin unidades, solo el mismo. */
export function idsUsuariosDelAmbito(u: UsuarioActual, soloActivos = false): Promise<number[] | "todos"> {
  return (soloActivos ? soloActivosDe : todosDe)(u);
}
const soloActivosDe = porObjeto((u: UsuarioActual) => calcularIdsDelAmbito(u, true));
const todosDe = porObjeto((u: UsuarioActual) => calcularIdsDelAmbito(u, false));

async function calcularIdsDelAmbito(u: UsuarioActual, soloActivos: boolean): Promise<number[] | "todos"> {
  if (u.isAdmin) return "todos";
  const unidades = await ambitoUnidades(u);
  if (!unidades.length) return [u.id];
  const filas = await db.users.findMany({
    where: { area_id: { in: unidades }, ...(soloActivos ? { is_active: true } : {}) },
    select: { id: true },
  });
  const ids = filas.map((f) => f.id);
  return ids.length ? ids : [u.id];
}

/*
 * Filtro Prisma de las tareas visibles por ambito (sin borradas). Combinar con AND.
 * Deja fuera los ESTUDIOS (task_type 'estudio'): son el contenedor de sus pasos, que
 * si son tareas, y contarlos tambien duplicaria carga, entregas y cifras. Los estudios
 * se leen con filtroEstudiosVisibles.
 */
export async function filtroTareasVisibles(u: UsuarioActual): Promise<Prisma.tasksWhereInput> {
  return alcanceDeTipo(u, { task_type: { not: "estudio" } });
}

/* Los estudios que la persona puede ver: mismo ambito que las tareas, solo el tipo estudio. */
export async function filtroEstudiosVisibles(u: UsuarioActual): Promise<Prisma.tasksWhereInput> {
  return alcanceDeTipo(u, { task_type: "estudio" });
}

async function alcanceDeTipo(u: UsuarioActual, tipo: Prisma.tasksWhereInput): Promise<Prisma.tasksWhereInput> {
  const base: Prisma.tasksWhereInput = { deleted_at: null, ...tipo };
  if (u.isAdmin) return base;
  const unidades = await ambitoUnidades(u);
  const usuarios = await idsUsuariosDelAmbito(u);
  const porPersona: Prisma.tasksWhereInput = { assignee_id: { in: usuarios === "todos" ? [] : usuarios } };
  return {
    ...base,
    OR: unidades.length ? [{ area_id: { in: unidades } }, porPersona] : [porPersona],
  };
}

type TareaMinima = { id: number; area_id: number | null; assignee_id: number; visibility: string };

export async function tareaEnAmbito(u: UsuarioActual, t: TareaMinima): Promise<boolean> {
  if (u.isAdmin) return true;
  const unidades = await ambitoUnidades(u);
  if (t.area_id != null && unidades.includes(t.area_id)) return true;
  const usuarios = await idsUsuariosDelAmbito(u);
  return usuarios !== "todos" && usuarios.includes(t.assignee_id);
}

export async function esObservador(taskId: number, userId: number) {
  return !!(await db.task_watchers.findFirst({ where: { task_id: taskId, user_id: userId }, select: { id: true } }));
}

export async function puedeVerTarea(u: UsuarioActual, t: TareaMinima) {
  if (await tareaEnAmbito(u, t)) return true;
  return t.visibility === "shared" && (await esObservador(t.id, u.id));
}

export async function puedeEditarTarea(u: UsuarioActual, t: TareaMinima) {
  return tareaEnAmbito(u, t);
}

/* Si puede asignarle trabajo a esa persona: misma regla que el ambito. */
export async function puedeAsignarA(u: UsuarioActual, asignado: { id: number; area_id: number | null }) {
  if (u.isAdmin) return true;
  const unidades = await ambitoUnidades(u);
  if (!unidades.length) return asignado.id === u.id;
  return asignado.area_id != null && unidades.includes(asignado.area_id);
}

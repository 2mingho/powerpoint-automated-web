import "server-only";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { enlaceNuevo } from "@/lib/solicitudes/reglas";

/*
 * La campana (blueprints/notifications.py). Todo filtra por user_id del que
 * pregunta: una notificacion ajena responde 404, ni se lee ni se marca.
 */

export type NotificacionVista = {
  id: number;
  tipo: string;
  titulo: string;
  cuerpo: string;
  enlace: string | null;
  leida: boolean;
  creada: string;
};

export async function contarNoLeidas(userId: number) {
  // Usa ix_notif_user_unread: lo sondea cada pestana abierta.
  return db.notifications.count({ where: { user_id: userId, read_at: null } });
}

export async function listarNotificaciones(userId: number, opts: { limite: number; soloNoLeidas: boolean }) {
  const [filas, noLeidas] = await Promise.all([
    db.notifications.findMany({
      where: { user_id: userId, ...(opts.soloNoLeidas ? { read_at: null } : {}) },
      // No leidas primero, y dentro de cada grupo lo mas reciente (como el CASE de Flask).
      orderBy: [{ read_at: { sort: "desc", nulls: "first" } }, { created_at: "desc" }, { id: "desc" }],
      take: opts.limite,
    }),
    contarNoLeidas(userId),
  ]);
  const items: NotificacionVista[] = filas.map((n) => ({
    id: n.id,
    tipo: n.kind,
    titulo: n.title,
    cuerpo: n.body ?? "",
    enlace: enlaceNuevo(n.link_url),
    leida: n.read_at != null,
    creada: (n.created_at ?? new Date(0)).toISOString(),
  }));
  return { items, noLeidas };
}

export async function marcarLeida(userId: number, id: number) {
  if (!Number.isInteger(id) || id <= 0) throw new ErrorApi(404, "Notificación no encontrada.");
  // Condicionado al dueno: sin fila propia no se toca nada y se responde 404.
  const r = await db.notifications.updateMany({ where: { id, user_id: userId, read_at: null }, data: { read_at: new Date() } });
  if (r.count === 0) {
    const existe = await db.notifications.findFirst({ where: { id, user_id: userId }, select: { id: true } });
    if (!existe) throw new ErrorApi(404, "Notificación no encontrada.");
  }
  return { noLeidas: await contarNoLeidas(userId) };
}

export async function marcarTodas(userId: number) {
  const r = await db.notifications.updateMany({ where: { user_id: userId, read_at: null }, data: { read_at: new Date() } });
  return { marcadas: r.count, noLeidas: 0 };
}

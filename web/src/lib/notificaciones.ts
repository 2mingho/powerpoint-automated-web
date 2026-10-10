import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export const TIPOS_NOTIFICACION = [
  "task_assigned", "task_reassigned", "task_due_soon", "task_overdue", "task_comment", "mention",
  "request_received", "request_accepted", "request_rejected", "task_watching", "finance_grant", "task_review",
] as const;
export type TipoNotificacion = (typeof TIPOS_NOTIFICACION)[number];

type Datos = {
  tipo: TipoNotificacion;
  titulo: string;
  cuerpo?: string;
  enlace?: string;
  entidad?: { tipo: string; id: number };
  actorId?: number;
};

type Cliente = Prisma.TransactionClient | typeof db;

/*
 * Notificacion in-app (services/notifications.py). Nunca se avisa a quien hizo
 * el cambio. Acepta un cliente de transaccion para que el aviso viaje en la
 * misma transaccion que el cambio que lo provoca.
 */
export async function notificar(userId: number, d: Datos, cliente: Cliente = db) {
  if (d.actorId != null && d.actorId === userId) return;
  await cliente.notifications.create({
    data: {
      user_id: userId,
      kind: d.tipo,
      title: d.titulo.slice(0, 255),
      body: d.cuerpo ?? null,
      link_url: d.enlace ?? null,
      entity_type: d.entidad?.tipo ?? null,
      entity_id: d.entidad?.id ?? null,
      created_at: new Date(),
    },
  });
}

export async function notificarVarios(userIds: number[], d: Datos, cliente: Cliente = db) {
  for (const id of new Set(userIds)) await notificar(id, d, cliente);
}

import { conUsuario, ok } from "@/lib/api";
import { db } from "@/lib/db";

/* Lo dio por visto, sea porque lo termino o porque lo salto (blueprints/tour.py). */
export const POST = conUsuario(async (_req, u) => {
  await db.users.update({ where: { id: u.id }, data: { tour_completed_at: new Date() } });
  return ok({ completado: true });
});

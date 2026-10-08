import { conUsuario, ok } from "@/lib/api";
import { db } from "@/lib/db";

/* Volver a verlo: quien lo salto sin querer en su primer minuto tiene que poder recuperarlo. */
export const POST = conUsuario(async (_req, u) => {
  await db.users.update({ where: { id: u.id }, data: { tour_completed_at: null } });
  return ok({ completado: false });
});

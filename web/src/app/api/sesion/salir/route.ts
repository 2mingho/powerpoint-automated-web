import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { obtenerSesion, usuarioActual } from "@/lib/auth/session";
import { registrarActividad } from "@/lib/actividad";
import { db } from "@/lib/db";

/*
 * Cerrar sesion es un POST: con un GET, cualquier pagina ajena (una imagen, un
 * enlace) cerraba la sesion de quien la visitara, porque la cookie SameSite=lax
 * viaja en las navegaciones de primer nivel.
 *
 * La cookie es sellada y sin estado: borrarla del navegador no basta si alguien
 * la copio. Se rota session_token, asi esa copia deja de valer en el servidor.
 */
export async function POST(req: Request) {
  const u = await usuarioActual();
  if (u) {
    await db.users.update({ where: { id: u.id }, data: { session_token: randomBytes(24).toString("hex") } });
    await registrarActividad(u.id, "logout", `Cierre de sesión: ${u.username}`);
  }
  const sesion = await obtenerSesion();
  sesion.destroy();
  return NextResponse.redirect(new URL("/login", req.url), 303);
}

export function GET() {
  return NextResponse.json({ error: "Para cerrar sesión usa el botón Salir." }, { status: 405, headers: { Allow: "POST" } });
}

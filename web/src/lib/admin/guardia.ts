import "server-only";
import { forbidden, redirect } from "next/navigation";
import { usuarioActual, type UsuarioActual } from "@/lib/auth/session";

/*
 * Puerta de las paginas de administracion. Las rutas de API usan
 * conUsuario(..., { soloAdmin: true }); las paginas llaman a esto dentro de su
 * <Suspense> antes de leer un solo dato. Sin sesion, a /login; con sesion y
 * sin rol admin, 403 (forbidden.tsx del segmento).
 */
export async function exigirAdmin(): Promise<UsuarioActual> {
  const u = await usuarioActual();
  if (!u) redirect("/login");
  if (!u.isAdmin) forbidden();
  return u;
}

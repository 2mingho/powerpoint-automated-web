"use server";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { obtenerSesion } from "@/lib/auth/session";
import { verificarContrasena } from "@/lib/auth/password";
import { registrarActividad } from "@/lib/actividad";
import { permitir } from "@/lib/limite";

export type EstadoLogin = { error?: string; email?: string };

export async function iniciarSesion(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = String(form.get("email") ?? "").trim();
  const contrasena = String(form.get("password") ?? "");
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();

  if (!permitir(`login:${ip}`, 5, 60_000)) {
    return { error: "Demasiados intentos. Espera un minuto y vuelve a probar.", email };
  }
  if (!email || !contrasena) return { error: "Escribe tu correo y tu contraseña.", email };

  const u = await db.users.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  // Mismo mensaje exista o no la cuenta: no se confirma que un correo esta registrado.
  if (!u || !verificarContrasena(u.password, contrasena)) {
    return { error: "Correo o contraseña incorrectos.", email };
  }
  if (!u.is_active) return { error: "Tu cuenta está desactivada. Habla con un administrador.", email };

  // Token nuevo por inicio de sesion; un cierre forzado lo invalida al marcar force_logout.
  const token = randomBytes(24).toString("hex");
  await db.users.update({ where: { id: u.id }, data: { session_token: token, force_logout: false } });

  const sesion = await obtenerSesion();
  sesion.userId = u.id;
  sesion.token = token;
  await sesion.save();

  await registrarActividad(u.id, "login", `Inicio de sesión: ${u.username}`);
  const destino = String(form.get("destino") ?? "/");
  redirect(destino.startsWith("/") && !destino.startsWith("//") ? destino : "/");
}

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
  // La ultima entrada de x-forwarded-for la añade el proxy de confianza; la
  // primera la escribe el cliente y se puede falsificar para saltarse el limite.
  const ip = (h.get("x-forwarded-for")?.split(",").at(-1) ?? h.get("x-real-ip") ?? "local").trim();

  // Se limita por IP y por cuenta: aunque alguien rote IPs, una misma cuenta
  // no admite mas de 5 intentos por minuto.
  const porIp = permitir(`login:ip:${ip}`, 5, 60_000);
  const porCuenta = permitir(`login:cuenta:${email.toLowerCase()}`, 5, 60_000);
  if (!porIp || !porCuenta) {
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

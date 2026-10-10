import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import type { ReglaCategoria } from "./tipos";

/*
 * Presets de clasificacion (las reglas guardadas de cada persona). Es CRUD
 * puro, asi que vive en JavaScript; el formato de rules_json es el mismo que
 * escribia Flask para que los presets de siempre sigan cargando:
 * [{ category, tematicas: [{ name, keywords: [..] }] }].
 *
 * Cada preset es de su dueno: ni el admin ve los de otro, como en Flask.
 */

const esquemaReglas = z.array(z.object({
  category: z.string().trim().max(200),
  tematicas: z.array(z.object({
    name: z.string().trim().max(200),
    keywords: z.union([z.array(z.string()), z.string()]).transform((k) =>
      (Array.isArray(k) ? k : k.split(",")).map((p) => p.trim()).filter(Boolean).slice(0, 500)),
  })).max(200),
})).max(100);

export function validarReglas(crudo: unknown): ReglaCategoria[] {
  const r = esquemaReglas.safeParse(crudo);
  if (!r.success) throw new ErrorApi(400, "Las reglas no tienen un formato válido.");
  return r.data;
}

function leerReglas(json: string): ReglaCategoria[] {
  try {
    const r = esquemaReglas.safeParse(JSON.parse(json));
    return r.success ? r.data : [];
  } catch {
    return [];
  }
}

export async function listarPresets(userId: number) {
  const filas = await db.classification_presets.findMany({
    where: { user_id: userId },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    select: { id: true, name: true, created_at: true },
  });
  return filas.map((p) => ({ id: p.id, nombre: p.name, creado: p.created_at?.toISOString() ?? null }));
}

export async function presetPropio(userId: number, id: number) {
  const p = Number.isInteger(id) ? await db.classification_presets.findFirst({ where: { id, user_id: userId } }) : null;
  if (!p) throw new ErrorApi(404, "Preset no encontrado.");
  return { id: p.id, nombre: p.name, reglas: leerReglas(p.rules_json) };
}

export function nombreValido(crudo: unknown) {
  const nombre = typeof crudo === "string" ? crudo.trim().slice(0, 100) : "";
  if (!nombre) throw new ErrorApi(400, "El nombre del preset es obligatorio.");
  return nombre;
}

export async function crearPreset(userId: number, nombre: string, reglas: ReglaCategoria[]) {
  const p = await db.classification_presets.create({
    data: { user_id: userId, name: nombre, rules_json: JSON.stringify(reglas), created_at: new Date() },
  });
  return { id: p.id, nombre: p.name };
}

export async function actualizarPreset(userId: number, id: number, cambios: { nombre?: string; reglas?: ReglaCategoria[] }) {
  await presetPropio(userId, id);
  const p = await db.classification_presets.update({
    where: { id },
    data: {
      ...(cambios.nombre ? { name: cambios.nombre } : {}),
      ...(cambios.reglas ? { rules_json: JSON.stringify(cambios.reglas) } : {}),
    },
  });
  return { id: p.id, nombre: p.name };
}

export async function borrarPreset(userId: number, id: number) {
  const p = await presetPropio(userId, id);
  await db.classification_presets.delete({ where: { id } });
  return p.nombre;
}

import "server-only";
import { ErrorApi } from "@/lib/api";

export const SOLO_ADMIN = { soloAdmin: true } as const;

/* Id numerico de un segmento dinamico; cualquier otra cosa es 404. */
export async function idDeRuta(ctx: { params: Promise<{ id: string }> }): Promise<number> {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new ErrorApi(404, "No encontrado.");
  return n;
}

export function texto(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function enteroONulo(v: unknown): number | null {
  if (v === null || v === "" || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const TONOS = ["neutro", "info", "aviso", "alerta", "bien", "violeta"] as const;
export function tono(v: unknown): string {
  return typeof v === "string" && (TONOS as readonly string[]).includes(v) ? v : "neutro";
}

/* Error de unicidad de Postgres a traves de Prisma. */
export function esDuplicado(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002";
}

export const MAX_LOTE = 500;

export function idsDeLote(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

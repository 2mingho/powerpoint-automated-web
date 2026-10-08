import "server-only";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { PROVEEDORES_IA } from "./consultas";
import { texto } from "./api";

/*
 * Conexiones a proveedores de IA (ia_* de admin.py y test_connection de
 * services/ai_provider.py). La clave entra pero nunca sale: ni en respuestas,
 * ni en el registro de actividad, ni en mensajes de error.
 */

const ENDPOINTS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

function precio(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function leerConexion(d: Record<string, unknown>) {
  const nombre = texto(d.nombre, 100);
  const proveedor = texto(d.proveedor, 50).toLowerCase();
  const modelo = texto(d.modelo, 150);
  const clave = typeof d.clave === "string" ? d.clave.trim() : "";
  if (!nombre || !modelo) throw new ErrorApi(400, "El nombre y el modelo son obligatorios.");
  if (!(PROVEEDORES_IA as readonly string[]).includes(proveedor)) throw new ErrorApi(400, `Proveedor no soportado: ${proveedor || "(vacío)"}.`);
  return { nombre, proveedor, modelo, clave, precioIn: precio(d.precioIn), precioOut: precio(d.precioOut) };
}

export async function nombreLibre(nombre: string, salvo?: number) {
  const otro = await db.ai_providers.findFirst({ where: { name: { equals: nombre, mode: "insensitive" }, ...(salvo ? { NOT: { id: salvo } } : {}) }, select: { id: true } });
  if (otro) throw new ErrorApi(409, `Ya existe una conexión llamada "${nombre}".`);
}

export async function probarConexion(proveedor: string, modelo: string, clave: string): Promise<{ ok: boolean; mensaje: string }> {
  const prompt = "Responde unicamente con la palabra: ok";
  const url = ENDPOINTS[proveedor];
  if (!url) return { ok: false, mensaje: `Proveedor no soportado: ${proveedor}` };
  try {
    const anthropic = proveedor === "anthropic";
    const r = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: anthropic
        ? { "x-api-key": clave, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
        : { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
      body: JSON.stringify(anthropic
        ? { model: modelo, max_tokens: 16, temperature: 0, messages: [{ role: "user", content: prompt }] }
        : { model: modelo, temperature: 0, messages: [{ role: "user", content: prompt }] }),
    });
    if (r.status === 401) return { ok: false, mensaje: "La clave API fue rechazada (401)." };
    if (r.status === 404) return { ok: false, mensaje: `El modelo "${modelo}" no existe para este proveedor (404).` };
    if (!r.ok) return { ok: false, mensaje: `El proveedor respondió con error ${r.status}.` };
    const d = await r.json();
    const textoResp: string = anthropic ? d?.content?.[0]?.text ?? "" : d?.choices?.[0]?.message?.content ?? "";
    return { ok: true, mensaje: `Conexión correcta. Respuesta: ${textoResp.trim().slice(0, 60)}` };
  } catch (e) {
    const motivo = e instanceof Error && e.name === "TimeoutError" ? "el proveedor no respondió a tiempo" : "error de red";
    return { ok: false, mensaje: `No se pudo conectar: ${motivo}.` };
  }
}

/*
 * Llamadas JSON desde el cliente a /api. Los errores llegan como
 * { error: "mensaje en espanol" } y se lanzan con ese texto para mostrarlo tal
 * cual en el aviso. Una sesion caducada o cerrada por un admin manda a /login.
 */
import { irAlLogin } from "@/components/ui/sesion";

export class ErrorPedido extends Error {
  constructor(public status: number, mensaje: string) { super(mensaje); }
}

export async function pedir<T = unknown>(url: string, opts: { metodo?: string; cuerpo?: unknown; form?: FormData } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: opts.metodo ?? (opts.cuerpo !== undefined || opts.form ? "POST" : "GET"),
      headers: opts.cuerpo !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.form ?? (opts.cuerpo !== undefined ? JSON.stringify(opts.cuerpo) : undefined),
      cache: "no-store",
    });
  } catch {
    throw new ErrorPedido(0, "Sin conexión con el servidor. Revisa tu red y vuelve a intentarlo.");
  }
  if (r.status === 401) irAlLogin();
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorPedido(r.status, (datos as { error?: string }).error ?? `Error ${r.status}.`);
  return datos as T;
}

export function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : "Error inesperado. Intenta de nuevo.";
}

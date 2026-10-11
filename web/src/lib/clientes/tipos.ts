/*
 * Los tipos de cliente: tres, fijos. Un cliente puede no tener tipo (aun no se ha clasificado), pero si lo tiene es uno
 * de estos. La base lo exige (ck_clients_type); esta lista es la misma.
 */
export const TIPOS_CLIENTE = ["Privado", "Público", "Interno"] as const;
export type TipoCliente = (typeof TIPOS_CLIENTE)[number];

const clave = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/*
 * Lo que llega de un formulario o de una API: "" o null es «sin tipo»; el resto debe ser uno de los tres (se acepta
 * «publico» sin tilde o «PRIVADO» y se guarda con su escritura correcta). Cualquier otra cosa es un error.
 */
export function leerTipoCliente(crudo: unknown): { ok: true; valor: TipoCliente | null } | { ok: false; error: string } {
  if (crudo === null || crudo === undefined) return { ok: true, valor: null };
  if (typeof crudo !== "string") return { ok: false, error: `El tipo de cliente debe ser ${TIPOS_CLIENTE.join(", ")}.` };
  if (!crudo.trim()) return { ok: true, valor: null };
  const t = TIPOS_CLIENTE.find((x) => clave(x) === clave(crudo));
  return t ? { ok: true, valor: t } : { ok: false, error: `El tipo de cliente debe ser ${TIPOS_CLIENTE.join(", ")}.` };
}

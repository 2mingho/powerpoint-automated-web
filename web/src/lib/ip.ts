/*
 * IP de quien hace la peticion. La primera entrada de x-forwarded-for la
 * escribe el cliente y se falsifica; la ultima la añade el proxy de confianza
 * que tenemos delante. Sin proxy, cualquier cabecera es del cliente: el
 * despliegue debe poner uno (o reescribir x-real-ip).
 */
export function ipCliente(h: Headers): string | null {
  const ultima = h.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  const ip = (ultima || h.get("x-real-ip")?.trim() || "").slice(0, 45);
  return ip || null;
}

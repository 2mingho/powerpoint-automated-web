/* La clave de un proveedor de IA nunca sale entera del servidor: solo los cuatro ultimos caracteres. */
export function enmascararClave(clave: string): string {
  const k = clave.trim();
  if (k.length <= 8) return "••••";
  return `••••${k.slice(-4)}`;
}

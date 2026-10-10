/*
 * Una peticion a /api respondio 401: la sesion caduco o un admin forzo el
 * cierre. Todas las pantallas reaccionan igual: recarga completa a /login
 * (no hay estado que conservar) y vuelta a donde estaba al entrar.
 */
export function irAlLogin() {
  if (typeof window === "undefined" || window.location.pathname === "/login") return;
  const destino = new URL("/login", window.location.origin);
  destino.searchParams.set("destino", window.location.pathname + window.location.search);
  window.location.assign(destino.toString());
}

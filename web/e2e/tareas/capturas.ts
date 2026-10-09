/*
 * Capturas de revision visual de Inicio y Mis tareas: 1440 y 390 px, tema
 * claro y oscuro, con la sesion de analista (y de la lider en Inicio).
 *
 *   npx tsx e2e/tareas/capturas.ts   (BASE_URL y DATABASE_URL de .env; base sembrada con e2e/semilla.ts)
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { selloSesion } from "../comun";
import { BASE, sql } from "./apoyo";

const cookieDe = async (id: number) => ({ name: "nl_sesion", value: await selloSesion(id, { rotar: true }), url: BASE });

const DESTINO = new URL("../capturas/tareas/", import.meta.url).pathname;

async function main() {
  mkdirSync(DESTINO, { recursive: true });
  const navegador = await chromium.launch();
  const id = async (email: string) => (await sql<{ id: number }>("SELECT id FROM users WHERE email = $1", [email]))[0].id;
  const personas = { analista: await id("analista@local.test"), lider: await id("carlos@equipo.test") };
  const tareaConDetalle = (await sql<{ id: number }>("SELECT id FROM tasks WHERE title LIKE 'Reporte semanal de menciones%' AND deleted_at IS NULL LIMIT 1"))[0]?.id;

  const tomas: Array<{ nombre: string; ruta: string; quien: keyof typeof personas }> = [
    { nombre: "inicio", ruta: "/", quien: "analista" },
    { nombre: "inicio-lider", ruta: "/", quien: "lider" },
    { nombre: "tareas", ruta: `/tareas?tarea=${tareaConDetalle}`, quien: "analista" },
    { nombre: "tareas-tablero", ruta: "/tareas?alcance=unidad&vista=tablero", quien: "analista" },
    { nombre: "tareas-calendario", ruta: "/tareas?alcance=unidad&vista=calendario", quien: "analista" },
  ];
  for (const ancho of [1440, 390]) {
    for (const tema of ["light", "dark"] as const) {
      const contexto = await navegador.newContext({ viewport: { width: ancho, height: ancho > 800 ? 900 : 844 }, deviceScaleFactor: 1, colorScheme: tema });
      await contexto.addInitScript((t) => { try { localStorage.setItem("nl-tema", t); } catch {} }, tema);
      for (const toma of tomas) {
        if (ancho < 800 && toma.nombre === "tareas") {
          // En movil el pase es una hoja: una captura sin ella y otra con ella abierta.
          await contexto.clearCookies();
          await contexto.addCookies([await cookieDe(personas[toma.quien])]);
          const p = await contexto.newPage();
          await p.goto(`${BASE}/tareas`, { waitUntil: "load" });
          await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
          await p.screenshot({ path: `${DESTINO}tareas-${ancho}-${tema}.png`, fullPage: false });
          await p.goto(`${BASE}${toma.ruta}`, { waitUntil: "load" });
          await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
          await p.waitForTimeout(1500);
          await p.screenshot({ path: `${DESTINO}tareas-pase-${ancho}-${tema}.png`, fullPage: false });
          await p.close();
          continue;
        }
        await contexto.clearCookies();
        await contexto.addCookies([await cookieDe(personas[toma.quien])]);
        const p = await contexto.newPage();
        await p.goto(`${BASE}${toma.ruta}`, { waitUntil: "load" });
        await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await p.waitForTimeout(1500);
        await p.screenshot({ path: `${DESTINO}${toma.nombre}-${ancho}-${tema}.png`, fullPage: ancho < 800 || toma.nombre.startsWith("inicio") });
        await p.close();
      }
      await contexto.close();
    }
  }
  await navegador.close();
  console.log(`Capturas en ${DESTINO}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => process.exit());

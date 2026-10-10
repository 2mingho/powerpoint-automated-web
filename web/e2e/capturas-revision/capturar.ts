/*
 * Capturas de la revision de acabado (finish review). No es una prueba: es un
 * guion por fases, porque las semillas de tareas, solicitudes y admin se
 * pisan entre si y cada fase necesita la suya recien sembrada.
 *
 *   BASE_URL=http://127.0.0.1:3401 DATABASE_URL=... npx tsx e2e/capturas-revision/capturar.ts <fase>
 *
 * Fases: tareas | movimiento | solicitudes | admin | datos
 * Destino: ../.impeccable/review/ (raiz del repo).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { cerrarBase } from "../comun";
import { cookieDe } from "../seguridad/apoyo";
import { BASE, sql } from "../tareas/apoyo";

const DESTINO = path.resolve(__dirname, "../../../.impeccable/review");
const WIDGETS = path.resolve(__dirname, "../../../tests/fixtures/meltwater_widgets");
const ANCHOS = [1440, 390] as const;
const TEMAS = ["light", "dark"] as const;
type Tema = (typeof TEMAS)[number];

const idDe = async (email: string) => (await sql<{ id: number }>("SELECT id FROM users WHERE email = $1", [email]))[0].id;

async function contexto(nav: Browser, ancho: number, tema: Tema, extra: Parameters<Browser["newContext"]>[0] = {}) {
  const c = await nav.newContext({ viewport: { width: ancho, height: ancho > 800 ? 900 : 844 }, deviceScaleFactor: 1, colorScheme: tema, hasTouch: ancho < 800, ...extra });
  await c.addInitScript((t) => { try { localStorage.setItem("nl-tema", t); } catch { /* sin almacenamiento */ } }, tema);
  return c;
}

async function como(c: BrowserContext, email: string) {
  await c.clearCookies();
  await c.addCookies([await cookieDe(await idDe(email))]);
}

async function asentar(p: Page, ms = 1500) {
  await p.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await p.waitForTimeout(ms);
}

async function foto(p: Page, nombre: string, ancho: number, tema: Tema, completa = true) {
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(200);
  const archivo = path.join(DESTINO, `${nombre}-${ancho}-${tema === "light" ? "claro" : "oscuro"}.png`);
  await p.screenshot({ path: archivo, fullPage: completa });
  console.log("ok", path.basename(archivo));
}

/* Recorre todas las combinaciones de ancho y tema con una sesion. */
async function cadaVista(nav: Browser, email: string | null, fn: (p: Page, ancho: number, tema: Tema) => Promise<void>) {
  for (const ancho of ANCHOS) for (const tema of TEMAS) {
    const c = await contexto(nav, ancho, tema);
    if (email) await como(c, email);
    const p = await c.newPage();
    try { await fn(p, ancho, tema); } catch (e) { console.error("FALLO", email, ancho, tema, (e as Error).message.split("\n")[0]); }
    await c.close();
  }
}

async function faseTareas(nav: Browser) {
  await sql("UPDATE users SET tour_completed_at = now() WHERE tour_completed_at IS NULL");
  const conDetalle = (await sql<{ id: number }>("SELECT id FROM tasks WHERE title LIKE 'Reporte semanal de menciones%' AND deleted_at IS NULL LIMIT 1"))[0].id;

  await cadaVista(nav, null, async (p, a, t) => { await p.goto(`${BASE}/login`); await asentar(p, 800); await foto(p, "login", a, t); });

  await cadaVista(nav, "analista@local.test", async (p, a, t) => {
    await p.goto(`${BASE}/`); await asentar(p); await foto(p, "inicio-analista", a, t);
    await p.goto(`${BASE}/tareas`); await asentar(p); await foto(p, "tareas-panel", a, t);
    await p.goto(`${BASE}/tareas?alcance=unidad&vista=tablero`); await asentar(p); await foto(p, "tareas-tablero", a, t);
    await p.goto(`${BASE}/tareas?alcance=unidad&vista=calendario`); await asentar(p); await foto(p, "tareas-calendario", a, t);
    await p.goto(`${BASE}/tareas?tarea=${conDetalle}`); await asentar(p, 2000); await foto(p, "tareas-pase", a, t, false);
    await p.goto(`${BASE}/`); await asentar(p, 800);
    await p.locator('[data-tour="campana"]:visible').first().click(); await p.waitForTimeout(700);
    await foto(p, "campana-analista", a, t, false);
    await p.keyboard.press("Escape");
    await p.keyboard.press("Control+k"); await p.waitForTimeout(500);
    await foto(p, "paleta-vacia", a, t, false);
    await p.keyboard.type("reporte"); await p.waitForTimeout(1200);
    await foto(p, "paleta-busqueda", a, t, false);
  });

  await cadaVista(nav, "lucia.mendez@local.test", async (p, a, t) => {
    await p.goto(`${BASE}/`); await asentar(p); await foto(p, "inicio-lider", a, t);
  });
}

/*
 * Movimiento firma: cambia la entrega y luego el estado de una tarea desde el
 * pase y mide, fotograma a fotograma, la posicion de su fila y el fondo de su
 * celda de estado. Repite con prefers-reduced-motion: reduce.
 */
async function faseMovimiento(nav: Browser) {
  await sql("UPDATE users SET tour_completed_at = now() WHERE tour_completed_at IS NULL");
  const objetivo = (await sql<{ id: number; title: string }>(
    "SELECT t.id, t.title FROM tasks t JOIN users u ON u.id = t.assignee_id WHERE u.email = 'analista@local.test' AND t.status = 'Pendiente' AND t.deleted_at IS NULL ORDER BY t.due_date ASC LIMIT 1"))[0];
  console.log("tarea objetivo", objetivo);
  const informe: Record<string, unknown> = { objetivo };

  for (const modo of ["normal", "reducido"] as const) {
    const c = await contexto(nav, 1440, "light", { reducedMotion: modo === "reducido" ? "reduce" : "no-preference", recordVideo: { dir: path.join(DESTINO, "video"), size: { width: 1440, height: 900 } } });
    await como(c, "analista@local.test");
    const p = await c.newPage();
    await p.goto(`${BASE}/tareas?tarea=${objetivo.id}`);
    await asentar(p, 1500);

    // Rastreador: cada fotograma, top de la fila, transform y fondo de la celda.
    // Como cadena: tsx (esbuild con keepNames) inyecta __name en funciones con nombre y el navegador no lo conoce.
    await p.evaluate(`(() => {
      const id = ${objetivo.id};
      window.__traza = []; window.__parar = false;
      const t0 = performance.now();
      function paso() {
        const fila = document.querySelector('[data-tarea="' + id + '"]');
        const celda = fila ? fila.querySelector('[data-encendida], span.inline-flex.h-6') : null;
        window.__traza.push({
          t: Math.round(performance.now() - t0),
          top: fila ? Math.round(fila.getBoundingClientRect().top) : null,
          transform: fila ? getComputedStyle(fila).transform : null,
          fondo: celda ? getComputedStyle(celda).backgroundColor : null,
          encendida: !!(fila && fila.querySelector('[data-encendida]')),
        });
        if (!window.__parar) requestAnimationFrame(paso);
      }
      requestAnimationFrame(paso);
    })()`);

    // 1) Mover la entrega 20 dias: la fila debe viajar a su nuevo sitio.
    const fecha = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const marca1 = await p.evaluate("Math.round(performance.now())");
    await p.getByLabel("Fecha de entrega").fill(fecha);
    for (let i = 0; i < 6; i++) { await p.screenshot({ path: path.join(DESTINO, `mov-${modo}-entrega-${i}.png`) }); await p.waitForTimeout(60); }
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(DESTINO, `mov-${modo}-entrega-final.png`) });

    // 2) Cambiar el estado a En Progreso.
    await p.getByRole("radio", { name: "En Progreso" }).click();
    for (let i = 0; i < 4; i++) { await p.screenshot({ path: path.join(DESTINO, `mov-${modo}-estado-${i}.png`) }); await p.waitForTimeout(80); }
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(DESTINO, `mov-${modo}-estado-final.png`) });

    // 3) Completar desde la fila.
    await p.getByRole("button", { name: `Completar «${objetivo.title}»` }).click().catch((e) => console.error("completar", e.message));
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(DESTINO, `mov-${modo}-completar-final.png`) });

    // 4) Esperar a que la celda se apague (8 s a la vista).
    await p.waitForTimeout(9000);
    await p.screenshot({ path: path.join(DESTINO, `mov-${modo}-apagada.png`) });

    const traza = (await p.evaluate("(() => { window.__parar = true; return window.__traza; })()")) as Array<{ t: number; top: number | null; transform: string | null; fondo: string | null; encendida: boolean }>;
    // Resumen: fotogramas con transform distinto de none (FLIP en curso) y posiciones intermedias.
    const conTransform = traza.filter((f) => f.transform && f.transform !== "none");
    const tops = [...new Set(traza.map((f) => f.top))];
    informe[modo] = {
      marcaInicio: marca1,
      fotogramas: traza.length,
      fotogramasConTransform: conTransform.length,
      primeraTransform: conTransform[0] ?? null,
      ultimaTransform: conTransform.at(-1) ?? null,
      posicionesDistintas: tops.length,
      tops: tops.slice(0, 60),
      encendidaFotogramas: traza.filter((f) => f.encendida).length,
      fondosDistintos: [...new Set(traza.map((f) => f.fondo))],
      muestra: traza.filter((_, i) => i % 6 === 0).slice(0, 120),
    };
    await c.close();
  }
  fs.writeFileSync(path.join(DESTINO, "movimiento-traza.json"), JSON.stringify(informe, null, 2));
  console.log("traza escrita");
}

async function faseSolicitudes(nav: Browser) {
  await sql("UPDATE users SET tour_completed_at = now() WHERE tour_completed_at IS NULL");
  await cadaVista(nav, "lider.di@local.test", async (p, a, t) => {
    await p.goto(`${BASE}/solicitudes`); await asentar(p); await foto(p, "solicitudes-lider", a, t);
    await p.locator('[data-tour="campana"]:visible').first().click(); await p.waitForTimeout(700);
    await foto(p, "campana-lider", a, t, false);
  });
  await cadaVista(nav, "externo@local.test", async (p, a, t) => {
    await p.goto(`${BASE}/solicitudes`); await asentar(p); await foto(p, "solicitudes-externo", a, t);
  });
}

async function faseAdmin(nav: Browser) {
  await sql("UPDATE users SET tour_completed_at = now() WHERE tour_completed_at IS NULL");
  await cadaVista(nav, "carlos@equipo.test", async (p, a, t) => {
    await p.goto(`${BASE}/equipo`); await asentar(p); await foto(p, "equipo-manager", a, t);
  });
  await cadaVista(nav, "laura@equipo.test", async (p, a, t) => {
    await p.goto(`${BASE}/equipo`); await asentar(p); await foto(p, "equipo-directora", a, t);
  });
  await cadaVista(nav, "demo@local.test", async (p, a, t) => {
    for (const s of ["", "/personas", "/organizacion", "/catalogo", "/plantillas", "/ia", "/actividad"]) {
      await p.goto(`${BASE}/admin${s}`); await asentar(p); await foto(p, `admin${s.replace("/", "-")}`, a, t);
    }
  });
}

async function faseDatos(nav: Browser) {
  await sql("UPDATE users SET tour_completed_at = now() WHERE tour_completed_at IS NULL");
  const widgets = fs.readdirSync(WIDGETS).filter((f) => f.endsWith(".xlsx")).sort().map((f) => path.join(WIDGETS, f));
  const utf16 = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);

  for (const ancho of ANCHOS) {
    // Un contexto por ancho; el tema se cambia en caliente para no repetir procesos.
    const c = await contexto(nav, ancho, "light");
    await como(c, "demo@local.test");
    const p = await c.newPage();
    const ambos = async (nombre: string, completa = true) => {
      for (const t of TEMAS) {
        await p.evaluate((v) => { localStorage.setItem("nl-tema", v); document.documentElement.dataset.theme = v; }, t);
        await foto(p, nombre, ancho, t, completa);
      }
    };
    try {
      await p.goto(`${BASE}/reportes/nuevo`); await asentar(p, 800);
      await ambos("reporte-nuevo-vacio");
      await p.locator('input[type="file"]').setInputFiles(widgets);
      await p.getByText(/widgets reconocidos/).waitFor({ timeout: 30_000 });
      await p.getByRole("button", { name: "Continuar" }).click();
      await p.getByLabel("Nombre del reporte").fill("Ministerio de Turismo");
      await ambos("reporte-nuevo-opciones");

      // Progreso real, fotograma a fotograma (solo en escritorio y claro).
      const fases: Array<{ t: number; texto: string }> = [];
      const t0 = Date.now();
      await p.getByRole("button", { name: "Generar reporte" }).click();
      let n = 0;
      while (!/\/reportes\/[\w-]{10,}$/.test(p.url()) && Date.now() - t0 < 120_000) {
        const texto = await p.locator("ol[aria-live]").innerText().catch(() => "");
        if (texto && (!fases.length || fases.at(-1)!.texto !== texto)) {
          fases.push({ t: Date.now() - t0, texto: texto.replace(/\s+/g, " ") });
          if (n < 8) { await p.screenshot({ path: path.join(DESTINO, `proceso-real-${ancho}-${n++}.png`), fullPage: false }); }
        }
        await p.waitForTimeout(100);
      }
      fs.writeFileSync(path.join(DESTINO, `proceso-real-${ancho}.json`), JSON.stringify(fases, null, 2));
      await asentar(p, 2500);
      const token = p.url();
      await ambos("reporte-vista");

      // Proceso a medias congelado en una fase real intermedia, para las fotos en los dos temas.
      await p.goto(`${BASE}/reportes/nuevo`); await asentar(p, 600);
      await p.locator('input[type="file"]').setInputFiles(widgets);
      await p.getByText(/widgets reconocidos/).waitFor({ timeout: 30_000 });
      await p.getByRole("button", { name: "Continuar" }).click();
      await p.getByLabel("Nombre del reporte").fill("Ministerio de Turismo");
      await p.route("**/api/datos/trabajos/*", (r) => r.fulfill({ json: { id: "x", tipo: "reporte", estado: "en_curso", fase: "calculo", progreso: 62, mensaje: "Sumando menciones, alcance y reparto por red", error: null, detalle: [], resultado: null } }));
      await p.getByRole("button", { name: "Generar reporte" }).click();
      await p.getByText("62%").waitFor({ timeout: 30_000 });
      await p.waitForTimeout(600);
      await ambos("reporte-nuevo-proceso-a-medias");
      await p.unroute("**/api/datos/trabajos/*");
      await p.waitForURL(/\/reportes\/[\w-]{10,}$/, { timeout: 90_000 }).catch(() => {});

      await p.goto(`${BASE}/reportes`); await asentar(p); await ambos("reportes-lista");
      console.log("reporte", token);

      await p.goto(`${BASE}/clasificacion`); await asentar(p, 800); await ambos("clasificacion-vacia");
      await p.locator('input[type="file"]').setInputFiles({ name: "menciones.csv", mimeType: "text/csv",
        buffer: utf16("Hit Sentence\tSource\tKeywords\nSuben los precios del pan\tTwitter\tinflacion\nNuevo hospital en Santiago\tFacebook\tsalud\nEl turismo crece en Punta Cana\tInstagram\tturismo\nClinica nueva en la capital\tTwitter\tsalud\nPartido de beisbol\tX\tdeporte\n") });
      await p.getByText(/UTF-16 · tabulador/).waitFor();
      await p.getByRole("button", { name: "Continuar" }).click();
      await p.getByRole("textbox", { name: "Categoría 1" }).fill("Economía");
      await p.getByLabel("Temática").first().fill("Precios");
      await p.getByLabel("Palabras clave, separadas por comas").first().fill("precios, inflación");
      await ambos("clasificacion-reglas");
      await p.getByRole("button", { name: "Clasificar" }).click();
      await p.getByRole("heading", { name: "Resultado" }).waitFor({ timeout: 60_000 });
      await asentar(p, 800); await ambos("clasificacion-resultado");

      await p.goto(`${BASE}/union`); await asentar(p, 800); await ambos("union-vacia");
      await p.locator('input[type="file"]').setInputFiles([
        { name: "enero.csv", mimeType: "text/csv", buffer: Buffer.from("Fecha,Fuente,Texto,Alcance\n2026-01-02,Twitter,hola,10\n") },
        { name: "febrero.csv", mimeType: "text/csv", buffer: Buffer.from("Fecha,Fuente,Texto\n2026-02-02,Facebook,adios\n") },
      ]);
      await p.getByText(/coma · 4 columnas/).waitFor();
      await p.getByRole("button", { name: "Continuar" }).click();
      await asentar(p, 600); await ambos("union-columnas");

      const filas = ["Fuente\tAlcance\tLikes\tComentarios"];
      const redes = ["Twitter", "Facebook", "Instagram", "TikTok", "YouTube"];
      for (let i = 0; i < 400; i++) filas.push(`${redes[(i * 7) % 5]}\t${(i * 37) % 900 + 50}\t${(i * 13) % 120}\t${i % 9 === 0 ? "" : (i * 5) % 40}`);
      await p.goto(`${BASE}/analisis`); await asentar(p, 800); await ambos("analisis-vacio");
      await p.locator('input[type="file"]').setInputFiles({ name: "metricas.csv", mimeType: "text/csv", buffer: utf16(filas.join("\n") + "\n") });
      await p.getByRole("button", { name: "Continuar" }).click();
      await p.getByRole("button", { name: "Analizar" }).click();
      await p.getByText("Correlación entre columnas numéricas").waitFor({ timeout: 60_000 });
      await asentar(p, 1200); await ambos("analisis-resultado");
    } catch (e) { console.error("FALLO datos", ancho, (e as Error).message.split("\n")[0]); }
    await c.close();
  }
}

async function main() {
  fs.mkdirSync(DESTINO, { recursive: true });
  const fase = process.argv[2];
  const nav = await chromium.launch();
  const fases: Record<string, (n: Browser) => Promise<void>> = { tareas: faseTareas, movimiento: faseMovimiento, solicitudes: faseSolicitudes, admin: faseAdmin, datos: faseDatos };
  if (!fases[fase]) throw new Error(`Fase desconocida: ${fase}`);
  await fases[fase](nav);
  await nav.close();
  await cerrarBase();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

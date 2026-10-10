/*
 * Sondeo de accesibilidad de la revision de acabado: objetivos tactiles a
 * 390 px, nombres accesibles de los controles y foco visible con teclado.
 *
 *   BASE_URL=http://127.0.0.1:3401 DATABASE_URL=... npx tsx e2e/capturas-revision/sondeo-a11y.ts
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { cerrarBase } from "../comun";
import { cookieDe } from "../seguridad/apoyo";
import { BASE, sql } from "../tareas/apoyo";

const DESTINO = path.resolve(__dirname, "../../../.impeccable/review");

// Como cadena: tsx inyecta __name en funciones con nombre y el navegador no lo conoce.
const MEDIR = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const nombre = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 50);
  const els = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [tabindex="0"]')].filter(vis);
  const pequenos = els.map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), nombre: nombre(el), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => x.h < 40 || x.w < 24);
  const sinNombre = els.filter((el) => !nombre(el) && !(el.labels && el.labels.length) && !el.getAttribute('placeholder')).map((el) => el.outerHTML.slice(0, 140));
  return { total: els.length, pequenos, sinNombre };
})()`;

const FOCO = `(() => {
  const el = document.activeElement; if (!el || el === document.body) return null;
  const s = getComputedStyle(el); const r = el.getBoundingClientRect();
  return { tag: el.tagName.toLowerCase(), nombre: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40), outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor, sombra: s.boxShadow.slice(0, 60), y: Math.round(r.top) };
})()`;

async function main() {
  const nav = await chromium.launch();
  const id = (await sql<{ id: number }>("SELECT id FROM users WHERE email = 'analista@local.test'"))[0].id;
  const informe: Record<string, unknown> = {};

  const movil = await nav.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await movil.addCookies([await cookieDe(id)]);
  const p = await movil.newPage();
  for (const ruta of ["/", "/tareas", "/tareas?alcance=unidad&vista=tablero", "/tareas?alcance=unidad&vista=calendario", "/solicitudes", "/reportes/nuevo"]) {
    await p.goto(BASE + ruta); await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(1200);
    informe[`tactil ${ruta}`] = await p.evaluate(MEDIR);
  }
  await movil.close();

  const escritorio = await nav.newContext({ viewport: { width: 1440, height: 900 } });
  await escritorio.addCookies([await cookieDe(id)]);
  const q = await escritorio.newPage();
  for (const ruta of ["/tareas?alcance=unidad&vista=tablero", "/tareas?alcance=unidad&vista=calendario", "/tareas"]) {
    await q.goto(BASE + ruta); await q.waitForLoadState("networkidle").catch(() => {}); await q.waitForTimeout(1000);
    const pasos: unknown[] = [];
    for (let i = 0; i < 45; i++) { await q.keyboard.press("Tab"); pasos.push(await q.evaluate(FOCO)); }
    informe[`teclado ${ruta}`] = pasos;
    await q.screenshot({ path: path.join(DESTINO, `foco-${ruta.includes("tablero") ? "tablero" : ruta.includes("calendario") ? "calendario" : "panel"}-1440.png`) });
  }
  // Paleta: flechas y Enter.
  await q.goto(BASE + "/"); await q.waitForTimeout(800);
  await q.keyboard.press("Control+k"); await q.waitForTimeout(300);
  await q.keyboard.press("ArrowDown"); await q.keyboard.press("ArrowDown");
  informe["paleta foco"] = await q.evaluate(FOCO);
  informe["paleta activo"] = await q.evaluate(`(() => { const a = document.querySelector('[role=option][aria-selected=true]'); return a ? a.textContent.trim().slice(0, 50) : null; })()`);
  await escritorio.close();

  fs.writeFileSync(path.join(DESTINO, "sondeo-a11y.json"), JSON.stringify(informe, null, 2));
  await nav.close(); await cerrarBase();
  console.log("sondeo escrito");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

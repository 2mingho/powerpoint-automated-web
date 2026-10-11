import { expect, test, type Page } from "@playwright/test";
import { idDeCorreo } from "../comun";
import { entrarComo, escenario, sql } from "./apoyo";

/*
 * Los controles que son solo un icono: (1) todos tienen nombre, y (2) ese nombre sale como rotulo al pasar el
 * raton o llegar con el teclado (components/ui/sugerencias.tsx).
 */
test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio", "El raton y el teclado se prueban una vez, en escritorio."); });

const RUTAS = [
  "/", "/?vista=panel", "/gastos", "/horas-extras", "/tareas", "/tareas?vista=tablero", "/tareas?vista=calendario", "/equipo", "/ingresos", "/estudios", "/solicitudes",
  "/clasificacion", "/analisis", "/reportes", "/union",
  "/admin", "/admin/personas", "/admin/organizacion", "/admin/clientes", "/admin/catalogo", "/admin/plantillas", "/admin/actividad", "/admin/ia",
];

/* Misma regla que el componente: sin texto visible (fuera de lo solo-para-lectores, aria-hidden y lo oculto). */
async function iconosSinNombre(page: Page) {
  return page.evaluate(() => {
    const lectores = (e: Element) => { const c = getComputedStyle(e); return c.position === "absolute" && parseFloat(c.width) <= 1 && parseFloat(c.height) <= 1; };
    const visibleTexto = (control: Element) => {
      const rec = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
      for (let n = rec.nextNode(); n; n = rec.nextNode()) {
        if (!n.textContent?.trim()) continue;
        let oculto = false;
        for (let p = n.parentElement; p; p = p.parentElement) {
          if (p.getAttribute("aria-hidden") === "true" || lectores(p) || (p.checkVisibility && !p.checkVisibility())) { oculto = true; break; }
          if (p === control) break;
        }
        if (!oculto) return true;
      }
      return false;
    };
    const malos: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, a[href], [role="button"], [role="tab"], [role="menuitem"], summary')) {
      if (!el.checkVisibility() || el.hasAttribute("data-sin-sugerencia") || visibleTexto(el)) continue;
      const nombre = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("data-sugerencia") || el.textContent || "";
      const lleva = el.querySelector("input, select, textarea") || (el instanceof HTMLButtonElement && el.closest("label"));
      if (!nombre.trim() && !el.getAttribute("aria-labelledby") && !lleva) malos.push(el.outerHTML.slice(0, 160));
    }
    return malos;
  });
}

test("ningun control de solo icono se queda sin nombre, en ninguna pantalla", async ({ context, page }) => {
  test.setTimeout(240_000);
  await entrarComo(context, await idDeCorreo("demo@local.test"));
  const fallos: string[] = [];
  for (const ruta of RUTAS) {
    const r = await page.goto(ruta);
    if (!r || r.status() >= 400) continue;
    await page.waitForLoadState("networkidle").catch(() => {});
    for (const html of await iconosSinNombre(page)) fallos.push(`${ruta}: ${html}`);
  }
  expect(fallos).toEqual([]);
});

test("tampoco en lo que se abre: pase de la tarea, nueva tarea, notificaciones, paleta, ficha de cliente y seleccion masiva", async ({ context, page }) => {
  test.setTimeout(120_000);
  await entrarComo(context, await idDeCorreo("demo@local.test"));
  const fallos: string[] = [];
  const revisar = async (donde: string) => { for (const html of await iconosSinNombre(page)) fallos.push(`${donde}: ${html}`); };

  await page.goto("/tareas?alcance=unidad");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("[data-tarea]").first().click();
  await expect(page.getByRole("dialog", { name: /pase/i }).or(page.getByLabel("Pase de la tarea")).first()).toBeVisible();
  await page.waitForTimeout(800);
  await revisar("pase de la tarea");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Seleccionar varias/i }).click().catch(() => {});
  await revisar("seleccion masiva");
  await page.getByRole("button", { name: /Salir de la selección|Terminar la selección/i }).first().click().catch(() => {});

  await page.getByRole("button", { name: /Nueva tarea/i }).first().click();
  await page.waitForTimeout(500);
  await revisar("nueva tarea");
  await page.keyboard.press("Escape");

  const campana = page.getByRole("button", { name: /notificaci/i }).first();
  if (await campana.count()) { await campana.click(); await page.waitForTimeout(500); await revisar("notificaciones"); await page.keyboard.press("Escape"); }

  await page.keyboard.press("Control+k");
  await page.waitForTimeout(400);
  await revisar("paleta de comandos");
  await page.keyboard.press("Escape");

  await page.goto("/admin/clientes");
  await page.waitForLoadState("networkidle").catch(() => {});
  const cliente = page.locator("main button, main a").filter({ hasText: /\S/ }).first();
  if (await cliente.count()) { await cliente.click().catch(() => {}); await page.waitForTimeout(500); await revisar("admin/clientes tras abrir una fila"); }
  expect(fallos).toEqual([]);
});

test.describe("el rotulo", () => {
  test.beforeEach(async ({ context }) => { await entrarComo(context, await idDeCorreo("demo@local.test")); });

  test("sale al pasar el raton por un icono, con su nombre, y se va al salir", async ({ page }) => {
    await page.goto("/tareas");
    const boton = page.getByRole("button", { name: "Actualizar la lista" });
    await expect(boton).toBeVisible();
    await boton.hover();
    const rotulo = page.getByRole("tooltip");
    await expect(rotulo).toBeVisible();
    await expect(rotulo).toHaveText("Actualizar la lista");
    // Queda pegado al control y dentro de la ventana.
    const [c, r, v] = [await boton.boundingBox(), await rotulo.boundingBox(), page.viewportSize()!];
    expect(Math.abs(r!.x + r!.width / 2 - (c!.x + c!.width / 2))).toBeLessThan(r!.width);
    expect(r!.x).toBeGreaterThanOrEqual(0);
    expect(r!.x + r!.width).toBeLessThanOrEqual(v.width);
    await page.mouse.move(5, 400);
    await expect(rotulo).toBeHidden();
  });

  test("con el teclado sale al llegar y Escape lo quita", async ({ page }) => {
    await page.goto("/tareas");
    const boton = page.getByRole("button", { name: "Actualizar la lista" });
    await boton.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tooltip")).toHaveText("Actualizar la lista");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toBeHidden();
  });

  test("lo que ya tiene texto visible no lleva rotulo, y pulsar lo quita", async ({ page }) => {
    await page.goto("/tareas");
    await page.getByRole("button", { name: /Nueva tarea/i }).first().hover();
    await page.waitForTimeout(700);
    await expect(page.getByRole("tooltip")).toBeHidden();
    await page.getByRole("button", { name: "Actualizar la lista" }).hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await page.mouse.down();
    await expect(page.getByRole("tooltip")).toBeHidden();
    await page.mouse.up();
  });

  test("un icono con title nativo enseña un solo rotulo y conserva su title al salir", async ({ page }) => {
    await page.goto("/tareas");
    await page.evaluate(() => {
      const b = document.createElement("button");
      b.id = "prueba-title";
      b.title = "Explicación del icono";
      b.style.cssText = "position:fixed;left:300px;top:300px;width:32px;height:32px";
      b.innerHTML = '<svg aria-hidden="true" width="16" height="16"><circle cx="8" cy="8" r="6"/></svg>';
      document.body.append(b);
    });
    const boton = page.locator("#prueba-title");
    await boton.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Explicación del icono");
    await expect(boton).not.toHaveAttribute("title", /./);
    await page.mouse.move(5, 5);
    await expect(page.getByRole("tooltip")).toBeHidden();
    await expect(boton).toHaveAttribute("title", "Explicación del icono");
  });
});

test("los iconos que solo informan (pasos, comentarios, repetición) también explican qué son", async ({ context, page }) => {
  const e = await escenario("sugerencias");
  const id = await e.tarea("Con pasos", e.alfa, e.empleado, e.empleado);
  await sql("UPDATE tasks SET is_recurrent = true, recurrence_type = 'Semanal' WHERE id = $1", [id]);
  for (const [i, hecho] of [true, false].entries()) {
    await sql("INSERT INTO task_checklist_items (task_id, body, position, is_completed, created_at) VALUES ($1, 'p', $2, $3, now())", [id, i, hecho]);
  }
  await sql("INSERT INTO task_comments (task_id, user_id, body, created_at) VALUES ($1, $2, 'hola', now())", [id, e.empleado]);
  await entrarComo(context, e.empleado);
  await page.goto("/tareas");
  const fila = page.locator(`[data-tarea="${id}"]`);
  await expect(fila).toBeVisible();
  const rotulo = page.getByRole("tooltip");
  await fila.locator("svg.lucide-list-checks").hover();
  await expect(rotulo).toHaveText("Pasos: 1 de 2 completados");
  await fila.locator("svg.lucide-message-square").hover();
  await expect(rotulo).toHaveText("1 comentario");
  await fila.locator("svg.lucide-repeat").hover();
  await expect(rotulo).toHaveText(/Se repite/);
});

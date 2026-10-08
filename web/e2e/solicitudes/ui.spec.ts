import { expect, test, type Page } from "@playwright/test";
import { consulta, entrar, sembrar } from "./ayuda";

/*
 * Flujos de interfaz en escritorio (1440) y movil (Pixel 7). Comparten base:
 * ejecutar con --workers=1. Cada proyecto vuelve a sembrar.
 */
test.describe.configure({ mode: "serial" });
test.beforeAll(() => sembrar());
test.setTimeout(90_000);

const esMovil = (p: Page) => (p.viewportSize()?.width ?? 0) < 1024;

async function abrirSolicitud(page: Page, titulo: string) {
  await page.getByRole("button", { name: new RegExp(`^${titulo}`) }).click();
  // En escritorio el pase esta a la derecha; en movil sube una hoja.
  return esMovil(page) ? page.getByRole("dialog", { name: "Detalle de la solicitud" }) : page.getByRole("complementary", { name: "Detalle de la solicitud" });
}

test("aceptar desde el pase crea la tarea, la fila cambia de estado y avisa a quien la pidio", async ({ page, context, browser }) => {
  await entrar(context, "lider.di@local.test");
  await page.goto("/solicitudes?bandeja=recibidas");
  const pase = await abrirSolicitud(page, "Informe de menciones de octubre");
  await pase.getByRole("button", { name: "Aceptar", exact: true }).click();
  await pase.getByRole("button", { name: "Crear tarea" }).click();
  await expect(pase.getByText("Elige a quién se le asigna la tarea.")).toBeVisible();
  await pase.getByLabel("Responsable").selectOption({ label: "analista" });
  await pase.getByRole("button", { name: "Crear tarea" }).click();
  await expect(pase.getByRole("link", { name: /Abrir tarea/ })).toBeVisible();
  await expect(pase.getByText("Aceptada", { exact: true }).first()).toBeVisible();
  const [s] = await consulta<{ status: string; created_task_id: number }>("SELECT status, created_task_id FROM task_requests WHERE title LIKE 'Informe de menciones%'");
  expect(s.status).toBe("Aceptada");
  expect(s.created_task_id).toBeTruthy();

  // La campana de quien la pidio la trae.
  const otro = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  await entrar(otro, "miembro.com@local.test");
  const p2 = await otro.newPage();
  await p2.goto("/solicitudes");
  const campana = p2.getByRole("button", { name: /Notificaciones: \d+ sin leer/ });
  await expect(campana).toBeVisible();
  await campana.click();
  const aviso = p2.getByRole("region", { name: "Notificaciones" }).getByRole("button", { name: /^Solicitud aceptada: Informe de menciones/ });
  await expect(aviso).toBeVisible();
  await aviso.click();
  await expect(p2).toHaveURL(/\/tareas\?tarea=\d+/);
  await otro.close();
});

test("rechazar pide un motivo y queda en el recorrido", async ({ page, context }) => {
  await entrar(context, "lider.di@local.test");
  await page.goto("/solicitudes?bandeja=recibidas");
  const pase = await abrirSolicitud(page, "Análisis de sentimiento");
  await pase.getByRole("button", { name: "Rechazar", exact: true }).click();
  await pase.getByLabel("Motivo").fill("no");
  await pase.getByRole("button", { name: "Rechazar solicitud" }).click();
  await expect(pase.getByText(/mínimo 5 caracteres/)).toBeVisible();
  await pase.getByLabel("Motivo").fill("Lo cubre el informe mensual de Diseño.");
  await pase.getByRole("button", { name: "Rechazar solicitud" }).click();
  await expect(pase.getByText("Motivo: Lo cubre el informe mensual de Diseño.")).toBeVisible();
});

test("quien pertenece a la unidad pero no la lidera ve la recibida sin poder resolverla", async ({ page, context }) => {
  await entrar(context, "analista@local.test");
  await page.goto("/solicitudes?bandeja=recibidas");
  const pase = await abrirSolicitud(page, "Monitoreo de marca");
  await expect(pase.getByText(/La decide quien lidera Data Intelligence/)).toBeVisible();
  await expect(pase.getByRole("button", { name: "Aceptar", exact: true })).toHaveCount(0);
});

test("?solicitar=1 abre el formulario; la nueva aparece en Enviadas y se puede cancelar", async ({ page, context }) => {
  await entrar(context, "sin.unidad@local.test");
  await page.goto("/solicitudes?solicitar=1");
  const dialogo = page.locator("dialog[open]");
  await expect(dialogo.getByRole("heading", { name: "Solicitar a otra unidad" })).toBeVisible();
  await expect(page).not.toHaveURL(/solicitar=1/);
  await dialogo.getByRole("button", { name: "Enviar solicitud" }).click();
  await expect(dialogo.getByText("Escribe qué necesitas.")).toBeVisible();
  const titulo = `Prueba UI ${test.info().project.name}`;
  await dialogo.getByLabel("Qué necesitas").fill(titulo);
  await dialogo.getByLabel("Unidad destino").selectOption({ label: "Diseño" });
  await dialogo.getByRole("button", { name: "Enviar solicitud" }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(page.getByRole("button", { name: new RegExp(`^${titulo}`) })).toBeVisible();

  const pase = await abrirSolicitud(page, titulo);
  await pase.getByRole("button", { name: "Cancelar solicitud" }).click();
  await pase.getByRole("button", { name: "Sí, cancelar" }).click();
  await expect(pase.getByText("Cancelada", { exact: true }).first()).toBeVisible();
});

test("la paleta abre con el teclado, filtra y navega", async ({ page, context }) => {
  test.skip(esMovil(page), "Sin teclado fisico en movil; se prueba el boton");
  await entrar(context, "analista@local.test");
  await page.goto("/");
  await page.getByRole("button", { name: /Buscar o ir a/ }).waitFor();
  const entrada = page.getByRole("combobox", { name: /Buscar una tarea/ });
  // El boton llega pintado del servidor; el atajo responde en cuanto hidrata.
  await expect(async () => {
    if (!(await entrada.isVisible())) await page.keyboard.press("Control+k");
    await expect(entrada).toBeFocused({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await entrada.fill("solicitu");
  await expect(page.getByRole("option", { name: "Solicitudes" })).toBeVisible();
  // Sin el endpoint de tareas, la paleta no rompe.
  await entrada.fill("informe");
  await expect(page.getByText(/Nada coincide con «informe»/)).toBeVisible();
  await entrada.fill("solicitu");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/solicitudes/);
});

test("la paleta tambien abre desde el boton de la cabecera", async ({ page, context }) => {
  await entrar(context, "analista@local.test");
  await page.goto("/");
  await page.getByRole("button", { name: /Buscar o ir a/ }).click();
  await page.getByRole("combobox", { name: /Buscar una tarea/ }).fill("tema");
  await expect(page.getByRole("option", { name: /Cambiar a tema/ })).toBeVisible();
});

test("tour: se ofrece en el primer acceso, 'Ahora no' cuenta como visto y se relanza desde ayuda", async ({ page, context }) => {
  await consulta("UPDATE users SET tour_completed_at = NULL WHERE email = 'nuevo@local.test'");
  await entrar(context, "nuevo@local.test");
  await page.goto("/");
  const tour = page.getByRole("dialog", { name: "Bienvenido a Newlink" });
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Ahora no" }).click();
  await expect(tour).toHaveCount(0);
  await expect.poll(async () => (await consulta<{ t: Date | null }>("SELECT tour_completed_at AS t FROM users WHERE email = 'nuevo@local.test'"))[0].t).not.toBeNull();

  await page.reload();
  await page.getByRole("button", { name: "Ver el tour de bienvenida" }).waitFor();
  await page.waitForTimeout(900);
  await expect(page.getByRole("dialog", { name: "Bienvenido a Newlink" })).toHaveCount(0);

  await page.getByRole("button", { name: "Ver el tour de bienvenida" }).click();
  await page.getByRole("dialog", { name: "Bienvenido a Newlink" }).getByRole("button", { name: "Empezar" }).click();
  await expect(page.getByRole("dialog", { name: "Todo lo tuyo está aquí" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "Un atajo que sirve para todo" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-tour-activo]")).toHaveCount(0);
});

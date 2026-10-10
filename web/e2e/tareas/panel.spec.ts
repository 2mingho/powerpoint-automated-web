import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { BASE, entrarComo, escenario, HOY, sql, sumarDias } from "./apoyo";

/*
 * Panel de Inicio (pestaña «Panel»). Lo sensible: las filas salen solo de lo
 * que la persona puede ver, y los filtros cruzados se combinan y se quitan.
 */

const URL_PANEL = `${BASE}/?vista=panel&periodo=todo`;

async function conClientes(prefijo: string) {
  const e = await escenario(prefijo);
  const clientes = new Map<string, number>();
  const cliente = async (nombre: string, tipo = "Corporativo") => {
    const nombreCompleto = `${nombre} ${e.sufijo}`;
    if (!clientes.has(nombreCompleto)) {
      clientes.set(nombreCompleto, (await sql<{ id: number }>("INSERT INTO clients (name, name_key, client_type, is_active, created_at) VALUES ($1, $2, $3, true, now()) RETURNING id", [nombreCompleto, nombreCompleto.toLowerCase(), tipo]))[0].id);
    }
    return { nombre: nombreCompleto, id: clientes.get(nombreCompleto)! };
  };
  /* Tarea de un cliente, con horas opcionales y, si esta cerrada, hace cuantos dias. */
  const tarea = async (titulo: string, cli: Awaited<ReturnType<typeof cliente>>, area: number, quien: number, estado: string, entrega: string, horas?: number, cerradaHace?: number) => {
    const t = await e.tarea(titulo, area, quien, quien, estado, entrega);
    await sql("UPDATE tasks SET client = $1, client_id = $2, estimated_hours = $4, done_at = CASE WHEN $5::int IS NULL THEN NULL ELSE now() - make_interval(days => $5::int) END WHERE id = $3", [cli.nombre, cli.id, t, horas ?? null, cerradaHace ?? null]);
    return t;
  };
  return { e, cliente, tarea };
}

async function abrir(page: Page, context: BrowserContext, quien: number, url = URL_PANEL) {
  await entrarComo(context, quien);
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Panel", level: 1 })).toBeVisible();
}

const tabla = (page: Page) => page.getByRole("table", { name: "Tareas que cumplen los filtros" });
/* Filas de datos: en movil el encabezado no existe. */
const filas = (page: Page) => tabla(page).getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
/* El armazon tiene otros campos "Cliente" (solicitar a otra unidad): los filtros se buscan en su region. */
const filtro = (page: Page, etiqueta: string) => page.getByRole("region", { name: "Filtros del panel" }).getByLabel(etiqueta, { exact: true });

/* Valor de una cifra del panel ("Vencidas" -> "2"). */
async function cifra(page: Page, rotulo: string) {
  const texto = await page.getByRole("group", { name: "Cifras del panel" }).getByText(rotulo, { exact: true }).locator("..").innerText();
  return texto.split("\n").map((l) => l.trim()).filter(Boolean)[1];
}

test.describe("alcance", () => {
  test("solo llegan las tareas que la persona puede ver, tambien en el HTML", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "El alcance se prueba una vez, en escritorio.");
    const { e, cliente, tarea } = await conClientes("pan-alcance");
    const c = await cliente("Altice");
    await tarea("Alfa visible", c, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 2));
    await tarea("Beta secreta", c, e.beta, e.ajeno, "Pendiente", sumarDias(HOY, 2));

    await abrir(page, context, e.empleado);
    await expect(tabla(page).getByText("Alfa visible")).toBeVisible();
    await expect(tabla(page).getByText("Beta secreta")).toHaveCount(0);
    await expect(filtro(page, "Unidad")).not.toContainText(`Beta ${e.sufijo}`);
    const crudo = await (await context.request.get(URL_PANEL)).text();
    expect(crudo).toContain("Alfa visible");
    expect(crudo).not.toContain("Beta secreta");
    expect(crudo).not.toContain(`ajeno.${e.sufijo}`);

    await abrir(page, context, e.ajeno);
    await expect(tabla(page).getByText("Beta secreta")).toBeVisible();
    await expect(tabla(page).getByText("Alfa visible")).toHaveCount(0);
  });

  test("sin la herramienta de tareas no hay pestañas ni panel: muestra Hoy", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const { e } = await conClientes("pan-sin-tareas");
    await sql("UPDATE users SET allowed_tools = '[\"reports\"]' WHERE id = $1", [e.empleado]);
    await entrarComo(context, e.empleado);
    await page.goto(URL_PANEL);
    await expect(page.getByRole("heading", { name: "Hoy", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Vistas de Inicio" })).toHaveCount(0);
    expect(await (await context.request.get(URL_PANEL)).text()).not.toContain("Tareas que cumplen los filtros");
  });

  test("sin sesion lleva al acceso", async ({ page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    await page.goto(URL_PANEL);
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("el panel en pantalla", () => {
  test("las pestañas llevan de Hoy al Panel y de vuelta", async ({ context, page }) => {
    const { e } = await conClientes("pan-pestanas");
    await entrarComo(context, e.empleado);
    await page.goto(`${BASE}/`);
    const pestanas = page.getByRole("navigation", { name: "Vistas de Inicio" });
    await expect(pestanas.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
    await pestanas.getByRole("link", { name: "Panel" }).click();
    await expect(page).toHaveURL(/vista=panel/);
    await expect(page.getByRole("heading", { name: "Panel", level: 1 })).toBeVisible();
    await expect(pestanas.getByRole("link", { name: "Panel" })).toHaveAttribute("aria-current", "page");
    await pestanas.getByRole("link", { name: "Hoy" }).click();
    await expect(page.getByRole("heading", { name: "Hoy", level: 1 })).toBeVisible();
  });

  test("los filtros se combinan, las listas se acotan y se quitan de uno en uno o todos", async ({ context, page }) => {
    const { e, cliente, tarea } = await conClientes("pan-filtros");
    const a = await cliente("Altice", "Corporativo");
    const b = await cliente("Arajet", "Aerolinea");
    await tarea("A uno", a, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 2));
    await tarea("A dos", a, e.alfa, e.companero, "Completado", sumarDias(HOY, 3), undefined, 0);
    await tarea("B uno", b, e.alfa, e.empleado, "En Progreso", sumarDias(HOY, 4));
    await abrir(page, context, e.empleado);

    await expect(filas(page)).toHaveCount(3);
    expect(await cifra(page, "Clientes")).toBe("2");
    expect(await cifra(page, "Tareas")).toBe("3");

    await filtro(page, "Cliente").selectOption({ label: `${a.nombre} (2)` });
    await expect(filas(page)).toHaveCount(2);
    await expect(tabla(page).getByText("B uno")).toHaveCount(0);
    expect(await cifra(page, "Tareas")).toBe("2");
    const chips = page.getByRole("list", { name: "Filtros activos" });
    await expect(chips).toContainText(a.nombre);

    // La lista del filtro elegido sigue entera; las demas se acotan al cliente (Arajet era de otro tipo).
    await expect(filtro(page, "Cliente").locator("option")).toHaveCount(1 + 2);
    await expect(filtro(page, "Tipo de cliente").locator("option")).toHaveCount(1 + 1);
    await filtro(page, "Estado").selectOption("bloqueada");
    await expect(page.getByText("Ninguna tarea con estos filtros")).toBeVisible();

    await chips.getByRole("button", { name: /Quitar el filtro Estado/ }).click();
    await expect(filas(page)).toHaveCount(2);
    await page.getByRole("button", { name: "Quitar todos los filtros" }).first().click();
    await expect(filas(page)).toHaveCount(3);
    await expect(chips).toHaveCount(0);
  });

  test("las cifras de estado son botones: filtran y un segundo clic lo quita", async ({ context, page }) => {
    const { e, cliente, tarea } = await conClientes("pan-kpi");
    const c = await cliente("Claro");
    await tarea("Vencida 1", c, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, -3));
    await tarea("Vencida 2", c, e.alfa, e.empleado, "En Progreso", sumarDias(HOY, -1));
    await tarea("Futura", c, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 9));
    await tarea("Hecha tarde", c, e.alfa, e.empleado, "Completado", sumarDias(HOY, -5), undefined, 1);
    await abrir(page, context, e.empleado);

    expect(await cifra(page, "Vencidas")).toBe("2");
    expect(await cifra(page, "Completadas")).toBe("1");
    expect(await cifra(page, "Abiertas")).toBe("3");
    const vencidas = page.getByRole("group", { name: "Cifras del panel" }).getByRole("button", { name: /Vencidas/ });
    await vencidas.click();
    await expect(vencidas).toHaveAttribute("aria-pressed", "true");
    await expect(filas(page)).toHaveCount(2);
    await expect(tabla(page).getByText("Futura")).toHaveCount(0);
    // Las demas cifras de estado no se vacian al elegir una: siguen mostrando su numero.
    expect(await cifra(page, "Completadas")).toBe("1");
    expect(await cifra(page, "Tareas")).toBe("2");

    await vencidas.click();
    await expect(vencidas).toHaveAttribute("aria-pressed", "false");
    await expect(filas(page)).toHaveCount(4);
  });

  test("a tiempo: sin cierres en 30 dias no inventa un 100 %; con ellos, el porcentaje", async ({ context, page }) => {
    const { e, cliente, tarea } = await conClientes("pan-tiempo");
    const c = await cliente("Tigo");
    await tarea("Pendiente", c, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 4));
    await abrir(page, context, e.empleado);
    expect(await cifra(page, "A tiempo")).toBe("—");

    await tarea("En fecha", c, e.alfa, e.empleado, "Completado", sumarDias(HOY, 2), undefined, 1);
    await tarea("Tarde", c, e.alfa, e.empleado, "Completado", sumarDias(HOY, -10), undefined, 1);
    await page.reload();
    expect(await cifra(page, "A tiempo")).toBe("50 %");
  });

  test("horas: la cifra suma las horas estimadas y las tareas sin estimar cuentan con las de por defecto", async ({ context, page }) => {
    const { e, cliente, tarea } = await conClientes("pan-horas");
    const c = await cliente("Viva");
    await tarea("Con horas", c, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 2), 10);
    await tarea("Sin horas", c, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 3));
    await abrir(page, context, e.empleado);
    expect(await cifra(page, "Tareas")).toBe("2");

    await page.getByRole("group", { name: "Qué se cuenta" }).getByRole("button", { name: "Horas" }).click();
    expect(await cifra(page, "Horas")).toBe("14");
    await expect(page.getByRole("group", { name: "Qué se cuenta" }).getByRole("button", { name: "Horas" })).toHaveAttribute("aria-pressed", "true");
    // La fila sin estimar lo dice con un asterisco.
    await expect(tabla(page).getByRole("row").filter({ hasText: "Sin horas" })).toContainText("4*");
  });

  test("periodo: lo que entrega fuera del periodo no aparece hasta ampliarlo", async ({ context, page }) => {
    const { e, cliente, tarea } = await conClientes("pan-periodo");
    const c = await cliente("Orange");
    await tarea("Hoy mismo", c, e.alfa, e.empleado, "Pendiente", HOY);
    await tarea("Lejana", c, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 90));
    await abrir(page, context, e.empleado, `${BASE}/?vista=panel`);
    await expect(filtro(page, "Periodo de entrega")).toHaveValue("mes");
    await expect(tabla(page).getByText("Hoy mismo")).toBeVisible();
    await expect(tabla(page).getByText("Lejana")).toHaveCount(0);

    await filtro(page, "Periodo de entrega").selectOption("todo");
    await expect(page).toHaveURL(/periodo=todo/);
    await expect(tabla(page).getByText("Lejana")).toBeVisible();

    await filtro(page, "Periodo de entrega").selectOption("rango");
    await filtro(page, "Desde").fill(sumarDias(HOY, 80));
    await expect(tabla(page).getByText("Hoy mismo")).toHaveCount(0);
    await expect(tabla(page).getByText("Lejana")).toBeVisible();
  });

  test("detalle: 40 filas y «Mostrar más» de 60 en 60", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const { e, cliente } = await conClientes("pan-paginas");
    const c = await cliente("Masivo");
    await sql(`INSERT INTO tasks (title, description, client, client_id, due_date, status, priority, area, area_id, creator_id, assignee_id, visibility, is_recurrent, created_at, updated_at)
      SELECT 'Masiva ' || lpad(g::text, 3, '0'), '', $1, $2, $3::date, 'Pendiente', 'Media', 'E2E', $4, $5, $5, 'unit', false, now(), now() FROM generate_series(1, 105) g`,
      [c.nombre, c.id, sumarDias(HOY, 1), e.alfa, e.empleado]);
    await abrir(page, context, e.empleado);
    await expect(filas(page)).toHaveCount(40);
    await page.getByRole("button", { name: "Mostrar 60 más" }).click();
    await expect(filas(page)).toHaveCount(100);
    await page.getByRole("button", { name: "Mostrar 5 más" }).click();
    await expect(filas(page)).toHaveCount(105);
    await expect(page.getByRole("button", { name: /Mostrar/ })).toHaveCount(0);
  });

  test("el nombre del cliente abre su ficha desde el detalle", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "El cursor es de escritorio.");
    const { e, cliente, tarea } = await conClientes("pan-ficha");
    const c = await cliente("Sinsa");
    await tarea("Con ficha", c, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 2));
    await abrir(page, context, e.empleado);
    await tabla(page).getByRole("button", { name: `Ficha del cliente ${c.nombre}` }).hover();
    const ficha = page.getByRole("dialog", { name: `Cliente: ${c.nombre}` });
    await expect(ficha).toBeVisible();
    await expect(ficha.getByText("Corporativo")).toBeVisible();
  });

  test("sin tareas en el periodo enseña que hacer", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const { e } = await conClientes("pan-vacio");
    await abrir(page, context, e.empleado);
    await expect(page.getByText("Sin tareas con entrega en este periodo")).toBeVisible();
  });
});

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

test.describe("graficos que filtran", () => {
  const barra = (page: Page, lista: string, nombre: string | RegExp) => page.getByRole("list", { name: lista, exact: true }).getByRole("button", { name: nombre });

  test("estado por cliente: pulsar una barra filtra, atenua a las demas y otro clic lo quita", async ({ context, page }) => {
    const { e, cliente, tarea } = await conClientes("pan-g-cliente");
    const a = await cliente("Altice");
    const b = await cliente("Arajet");
    await tarea("A1", a, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 2));
    await tarea("A2", a, e.alfa, e.empleado, "En Progreso", sumarDias(HOY, 3));
    await tarea("B1", b, e.alfa, e.companero, "Pendiente", sumarDias(HOY, 4));
    await abrir(page, context, e.empleado);

    const barraA = barra(page, "Estado por cliente", new RegExp(`^${a.nombre}: 2`));
    const barraB = barra(page, "Estado por cliente", new RegExp(`^${b.nombre}: 1`));
    await expect(barraA).toBeVisible();
    await barraA.click();
    await expect(barraA).toHaveAttribute("aria-pressed", "true");
    await expect(filas(page)).toHaveCount(2);
    await expect(page.getByRole("list", { name: "Filtros activos" })).toContainText(a.nombre);
    // El grafico no se filtra a si mismo: la otra barra sigue ahi, atenuada.
    await expect(barraB).toBeVisible();
    await expect(barraB).toHaveAttribute("aria-pressed", "false");
    // Y los demas graficos si cambian: la carga por persona se reduce a quien tiene tareas de A.
    await expect(page.getByRole("list", { name: "Estado por persona" }).getByRole("button")).toHaveCount(1);

    await barraA.click();
    await expect(filas(page)).toHaveCount(3);
    await expect(page.getByRole("list", { name: "Estado por persona" }).getByRole("button")).toHaveCount(2);
  });

  test("la leyenda filtra por estado y la carga por persona solo cuenta lo abierto", async ({ context, page }) => {
    const { e, cliente, tarea } = await conClientes("pan-g-estado");
    const c = await cliente("Claro");
    await tarea("Abierta", c, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 2));
    await tarea("Bloqueada", c, e.alfa, e.empleado, "Bloqueado", sumarDias(HOY, 3));
    await tarea("Cerrada", c, e.alfa, e.companero, "Completado", sumarDias(HOY, 1), undefined, 0);
    await abrir(page, context, e.empleado);

    const personas = page.getByRole("list", { name: "Estado por persona" });
    await expect(personas.getByRole("button")).toHaveCount(1); // la persona con solo lo cerrado no sale
    await expect(page.getByRole("heading", { name: "Carga por persona" })).toBeVisible();

    await page.getByRole("list", { name: "Leyenda y filtro de estados" }).getByRole("button", { name: "Bloqueada" }).click();
    await expect(filas(page)).toHaveCount(1);
    await expect(tabla(page).getByText("Bloqueada", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tareas por persona" })).toBeVisible();
  });

  test("entregas por semana: pulsar una semana deja solo sus entregas", async ({ context, page }) => {
    const { e, cliente, tarea } = await conClientes("pan-g-semana");
    const c = await cliente("Tigo");
    await tarea("Esta semana", c, e.alfa, e.empleado, "Pendiente", HOY);
    await tarea("En tres semanas", c, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 21));
    await abrir(page, context, e.empleado);

    const semanas = page.getByRole("list", { name: "Entregas por semana", exact: true }).getByRole("button");
    await expect(semanas).toHaveCount(4); // las dos vacias del medio tambien se dibujan
    await semanas.last().click();
    await expect(filas(page)).toHaveCount(1);
    await expect(tabla(page).getByText("En tres semanas")).toBeVisible();
    await expect(page.getByRole("list", { name: "Filtros activos" })).toContainText("Semana");
    await semanas.last().click();
    await expect(filas(page)).toHaveCount(2);
  });

  test("donas: tipo de cliente y unidad filtran desde su leyenda", async ({ context, page }) => {
    const { e, cliente, tarea } = await conClientes("pan-g-dona");
    const a = await cliente("Altice", "Corporativo");
    const b = await cliente("Arajet", "Aerolinea");
    await tarea("Corp 1", a, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 2));
    await tarea("Corp 2", a, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 3));
    await tarea("Aero 1", b, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 4));
    await abrir(page, context, e.empleado);

    const tipos = page.getByRole("list", { name: "Por tipo de cliente", exact: true });
    await expect(tipos.getByRole("button")).toHaveCount(2);
    await tipos.getByRole("button", { name: /^Aerolinea/ }).click();
    await expect(filas(page)).toHaveCount(1);
    await expect(tabla(page).getByText("Aero 1")).toBeVisible();
    await expect(tipos.getByRole("button")).toHaveCount(2); // sigue entera
    await tipos.getByRole("button", { name: /^Aerolinea/ }).click();
    await expect(filas(page)).toHaveCount(3);

    const unidades = page.getByRole("list", { name: "Por unidad", exact: true });
    await expect(unidades.getByRole("button")).toHaveCount(1);
  });

  test("las barras siguen la metrica: en horas suman horas", async ({ context, page }) => {
    const { e, cliente, tarea } = await conClientes("pan-g-horas");
    const c = await cliente("Viva");
    await tarea("H1", c, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 2), 10);
    await tarea("H2", c, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 3), 2.5);
    await abrir(page, context, e.empleado);
    await expect(barra(page, "Estado por cliente", new RegExp(`^${c.nombre}: 2 tareas`))).toBeVisible();
    await page.getByRole("group", { name: "Qué se cuenta" }).getByRole("button", { name: "Horas" }).click();
    await expect(barra(page, "Estado por cliente", new RegExp(`^${c.nombre}: 12[.,]5 h`))).toBeVisible();
  });

  test("los graficos no muestran nada de otras unidades", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const { e, cliente, tarea } = await conClientes("pan-g-alcance");
    const propio = await cliente("Propio");
    const ajeno = await cliente("Ajeno");
    await tarea("Mia", propio, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 2));
    await tarea("De Beta", ajeno, e.beta, e.ajeno, "Pendiente", sumarDias(HOY, 2));
    await abrir(page, context, e.empleado);
    await expect(barra(page, "Estado por cliente", new RegExp(`^${propio.nombre}`))).toBeVisible();
    await expect(barra(page, "Estado por cliente", new RegExp(`^${ajeno.nombre}`))).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Estado por persona" })).not.toContainText("ajeno.");
    await expect(page.getByRole("list", { name: "Por unidad", exact: true })).not.toContainText(`Beta ${e.sufijo}`);
  });
});

/*
 * El detalle se filtra en la base y las cifras salen de celdas agrupadas por la base: dos caminos que deben
 * decir lo mismo. Aqui el detalle se compara con lo que dice cada tarea sembrada, con todos los filtros.
 */
test.describe("detalle en el servidor", () => {
  type Fila = { id: number; titulo: string; estadoNombre: string; unidad: string; cliente: string; personaNombre: string; entrega: string };

  test("cada filtro del detalle devuelve exactamente las tareas que cumplen su criterio, y el total coincide con la cifra", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const { e, cliente, tarea } = await conClientes("pan-detalle");
    const a = await cliente("Alfa-cli", "Corporativo");
    const b = await cliente("Beta-cli", "Pyme");
    await sql("INSERT INTO finance_grants (user_id, area_id, kind, created_at) VALUES ($1, $2, 'contracts', now())", [e.empleado, e.alfa]);
    // El contrato Proyecto (empieza despues) gana al Fee donde se solapan; fuera de ambos, nada.
    const contrato = (cli: number, tipo: string, ini: string, fin: string) =>
      sql("INSERT INTO contracts (client_id, area_id, contract_type, amount, start_date, end_date, created_at, updated_at) VALUES ($1, $2, $3, 1000, $4, $5, now(), now())", [cli, e.alfa, tipo, ini, fin]);
    await contrato(a.id, "Fee", sumarDias(HOY, -60), sumarDias(HOY, 60));
    await contrato(a.id, "Proyecto", sumarDias(HOY, 0), sumarDias(HOY, 10));

    const t = {
      vencida: await tarea("Vencida A", a, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, -5), 2),
      vencidaB: await tarea("Vencida B", b, e.alfa, e.companero, "En Progreso", sumarDias(HOY, -20), null as unknown as number),
      hoyA: await tarea("Hoy A", a, e.alfa, e.empleado, "Pendiente", HOY, 3),
      pronto: await tarea("Pronto A", a, e.alfa, e.empleado, "Bloqueado", sumarDias(HOY, 3), 1),
      lejos: await tarea("Lejos A", a, e.alfa, e.empleado, "En Progreso", sumarDias(HOY, 40), 5),
      revision: await tarea("Revision B", b, e.alfa, e.companero, "En Revisión", sumarDias(HOY, 8), 2),
      hechaReciente: await tarea("Hecha reciente A", a, e.alfa, e.empleado, "Completado", sumarDias(HOY, -3), 2, 1),
      hechaVieja: await tarea("Hecha vieja B", b, e.alfa, e.companero, "Completado", sumarDias(HOY, -50), 2, 45),
      hechaSinFecha: await tarea("Hecha sin fecha A", a, e.alfa, e.empleado, "Completado", sumarDias(HOY, -9), 2),
    };
    await sql("UPDATE tasks SET estimated_hours = NULL WHERE id = $1", [t.vencidaB]);

    await entrarComo(context, e.empleado);
    const pedir = async (q: string) => {
      const r = await context.request.get(`${BASE}/api/panel/detalle?periodo=todo&${q.includes("limite") ? "" : "limite=100&"}${q}`);
      expect(r.status(), await r.text()).toBe(200);
      return (await r.json()) as { filas: Fila[]; total: number };
    };
    const ids = async (q: string) => (await pedir(q)).filas.map((f) => f.id).sort((x, y) => x - y);
    const quienes = (...xs: number[]) => xs.sort((x, y) => x - y);
    const todas = Object.values(t);

    expect(await ids("")).toEqual(quienes(...todas));
    expect(await ids(`cliente=${encodeURIComponent(b.nombre)}`)).toEqual(quienes(t.vencidaB, t.revision, t.hechaVieja));
    expect(await ids(`persona=${e.companero}`)).toEqual(quienes(t.vencidaB, t.revision, t.hechaVieja));
    expect(await ids("tipo=Pyme")).toEqual(quienes(t.vencidaB, t.revision, t.hechaVieja));
    expect(await ids("estado=vencida")).toEqual(quienes(t.vencida, t.vencidaB));
    expect(await ids("estado=abierta")).toEqual(quienes(t.vencida, t.vencidaB, t.hoyA, t.pronto, t.lejos, t.revision));
    expect(await ids("estado=hecha")).toEqual(quienes(t.hechaReciente, t.hechaVieja, t.hechaSinFecha));
    expect(await ids("estado=bloqueada")).toEqual(quienes(t.pronto));
    expect(await ids("estado=revision")).toEqual(quienes(t.revision));
    expect(await ids("estado=en_curso")).toEqual(quienes(t.vencidaB, t.lejos));
    expect(await ids(`semana=${HOY_LUNES()}`)).toEqual(quienes(...(await semanaDe(HOY_LUNES(), t))));
    // Contrato: lo de A que cae en el Puntual es Proyecto, el resto Fee; lo fuera de ambos o de otro cliente, ninguno.
    expect(await ids("contrato=Proyecto")).toEqual(quienes(t.hoyA, t.pronto));
    expect(await ids("contrato=Fee")).toEqual(quienes(t.vencida, t.lejos, t.hechaReciente, t.hechaSinFecha));
    // Filtros que se combinan se estrechan.
    expect(await ids(`cliente=${encodeURIComponent(a.nombre)}&estado=abierta`)).toEqual(quienes(t.vencida, t.hoyA, t.pronto, t.lejos));
    // Una unidad ajena o un valor que no existe no devuelven nada (y no fallan).
    expect(await ids("unidad=NoExiste")).toEqual([]);
    expect(await ids(`unidad=${encodeURIComponent(`Alfa ${e.sufijo}`)}`)).toEqual(quienes(...todas));

    // Orden: por defecto lo abierto por entrega y luego lo cerrado de mas reciente a mas antiguo.
    const orden = (await pedir("")).filas.map((f) => f.id);
    expect(orden).toEqual([t.vencidaB, t.vencida, t.hoyA, t.pronto, t.revision, t.lejos, t.hechaReciente, t.hechaSinFecha, t.hechaVieja]);
    // Orden pedido: por titulo, ascendente y descendente.
    const porTitulo = (await pedir("orden=tarea&dir=asc")).filas.map((f) => f.titulo);
    expect(porTitulo).toEqual([...porTitulo].sort((x, y) => x.localeCompare(y, "es")));
    expect((await pedir("orden=tarea&dir=desc")).filas.map((f) => f.titulo)).toEqual([...porTitulo].reverse());
    // Paginas: sin repetir ni saltarse filas.
    const p1 = (await pedir("limite=4&offset=0")).filas.map((f) => f.id);
    const p2 = (await pedir("limite=4&offset=4")).filas.map((f) => f.id);
    const p3 = (await pedir("limite=4&offset=8")).filas.map((f) => f.id);
    expect([...p1, ...p2, ...p3]).toEqual(orden);
    expect((await pedir("limite=4&offset=0")).total).toBe(todas.length);

    // Lo mismo en pantalla: la cifra de «Abiertas» (celdas) y el total del detalle (servidor) coinciden con cada filtro.
    await abrir(page, context, e.empleado);
    await expect(page.getByText(`${todas.length} tareas`)).toBeVisible();
    for (const [estado, cuantas] of [["Abiertas", 6], ["Vencidas", 2], ["Completadas", 3]] as const) {
      await page.getByRole("group", { name: "Cifras del panel" }).getByRole("button", { name: new RegExp(estado) }).click();
      await expect(filas(page)).toHaveCount(cuantas);
      expect(await cifra(page, estado)).toBe(String(cuantas));
      await page.getByRole("group", { name: "Cifras del panel" }).getByRole("button", { name: new RegExp(estado) }).click();
    }
  });

  test("sin sesion o sin la herramienta no hay detalle, y otra unidad no se cuela con ningun filtro", async ({ context, request }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    expect((await request.get(`${BASE}/api/panel/detalle`)).status()).toBe(401);
    const { e, cliente, tarea } = await conClientes("pan-detalle-aj");
    const c = await cliente("Ajeno-cli");
    const propia = await tarea("Propia", c, e.alfa, e.empleado, "Pendiente", HOY, 1);
    const ajena = await tarea("De Beta", c, e.beta, e.ajeno, "Pendiente", HOY, 1);
    await entrarComo(context, e.empleado);
    for (const q of ["", `cliente=${encodeURIComponent(c.nombre)}`, `persona=${e.ajeno}`, `unidad=${encodeURIComponent(`Beta ${e.sufijo}`)}`, `contrato=Fee`, "estado=abierta"]) {
      const r = await context.request.get(`${BASE}/api/panel/detalle?periodo=todo&${q}`);
      expect(r.status()).toBe(200);
      const ids = ((await r.json()) as { filas: { id: number }[] }).filas.map((f) => f.id);
      expect(ids, q).not.toContain(ajena);
      if (!q || q.startsWith("cliente") || q === "estado=abierta") expect(ids).toContain(propia);
    }
  });
});

/* Lunes de la semana de hoy y las tareas sembradas que entregan en ella (lo pide la prueba de arriba). */
function HOY_LUNES() {
  const d = new Date(`${HOY}T00:00:00Z`);
  return sumarDias(HOY, -((d.getUTCDay() + 6) % 7));
}
async function semanaDe(lunes: string, t: Record<string, number>) {
  const filas = await sql<{ id: number }>("SELECT id FROM tasks WHERE id = ANY($1) AND due_date BETWEEN $2::date AND $2::date + 6", [Object.values(t), lunes]);
  return filas.map((f) => f.id);
}

import { expect, test } from "@playwright/test";
import { BASE, entrarComo, escenario, HOY, sql, sumarDias, updatedAt } from "./apoyo";

/*
 * Campos de seguimiento: horas estimadas, revisor con aprobacion, motivo de
 * bloqueo y done_at. Cada prueba crea su propio escenario.
 */

test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio", "La API se prueba una vez, en escritorio."); });

async function como(contexto: import("@playwright/test").BrowserContext, userId: number) {
  await entrarComo(contexto, userId);
  return contexto.request;
}

const fila = async (id: number) => (await sql<{ done_at: Date | null; block_reason: string | null; estimated_hours: number | null; reviewer_id: number | null }>(
  "SELECT done_at, block_reason, estimated_hours, reviewer_id FROM tasks WHERE id = $1", [id]))[0];

test.describe("horas estimadas", () => {
  test("se guardan, aceptan coma decimal y se quitan con vacio", async ({ context }) => {
    const e = await escenario("horas");
    const t = await e.tarea("Con horas", e.alfa, e.empleado, e.empleado);
    const r = await como(context, e.empleado);
    for (const [envio, esperado] of [[6, 6], ["2,5", 2.5], ["", null]] as const) {
      const res = await r.put(`${BASE}/api/tareas/${t}`, { data: { estimated_hours: envio, expected_updated_at: await updatedAt(t) } });
      expect(res.status(), await res.text()).toBe(200);
      expect((await res.json()).tarea.horas).toBe(esperado);
      expect((await fila(t)).estimated_hours).toBe(esperado);
    }
  });

  test("rechaza cero, negativas, texto y mas de 1000", async ({ context }) => {
    const e = await escenario("horas-mal");
    const t = await e.tarea("Con horas", e.alfa, e.empleado, e.empleado);
    const r = await como(context, e.empleado);
    for (const malo of [0, -2, "abc", 1001]) {
      const res = await r.put(`${BASE}/api/tareas/${t}`, { data: { estimated_hours: malo } });
      expect(res.status(), String(malo)).toBe(400);
    }
    expect((await fila(t)).estimated_hours).toBeNull();
  });

  test("al crear se guardan horas y revisor", async ({ context }) => {
    const e = await escenario("crear");
    const r = await como(context, e.empleado);
    const res = await r.post(`${BASE}/api/tareas`, { data: { title: "Nueva", assignee_id: e.empleado, due_date: sumarDias(HOY, 3), estimated_hours: "3", reviewer_id: e.companero } });
    expect(res.status(), await res.text()).toBe(201);
    const { tarea } = await res.json();
    expect(tarea).toMatchObject({ horas: 3, revisorId: e.companero });
  });
});

test.describe("cierre: done_at y motivo de bloqueo", () => {
  test("cerrar fija done_at y borra el motivo; reabrir lo quita; entre abiertos no cambia", async ({ context }) => {
    const e = await escenario("done");
    const t = await e.tarea("Se cierra", e.alfa, e.empleado, e.empleado);
    const r = await como(context, e.empleado);
    const poner = async (cuerpo: Record<string, unknown>) => {
      const res = await r.put(`${BASE}/api/tareas/${t}`, { data: { ...cuerpo, expected_updated_at: await updatedAt(t) } });
      expect(res.status(), await res.text()).toBe(200);
      return (await res.json()).tarea;
    };

    const bloqueada = await poner({ status: "Bloqueado", block_reason: "Espera datos del cliente" });
    expect(bloqueada).toMatchObject({ estado: "Bloqueado", motivoBloqueo: "Espera datos del cliente", cerradaEl: "" });

    const cerrada = await poner({ status: "Completado", block_reason: "ignorado al cerrar" });
    expect(cerrada.motivoBloqueo).toBe("");
    expect(cerrada.cerradaEl).not.toBe("");
    const original = (await fila(t)).done_at!;
    expect(original).not.toBeNull();

    // De un estado cerrado a otro cerrado no se pierde la fecha real de cierre: aqui solo hay un final, asi que se prueba reabriendo.
    const reabierta = await poner({ status: "En Progreso" });
    expect(reabierta.cerradaEl).toBe("");
    expect((await fila(t)).done_at).toBeNull();

    const abierta = await poner({ status: "Pendiente" });
    expect(abierta.cerradaEl).toBe("");
  });

  test("el tablero y las operaciones masivas tambien fijan y quitan done_at", async ({ context }) => {
    const e = await escenario("done-mov");
    const a = await e.tarea("Por tablero", e.alfa, e.empleado, e.empleado);
    const b = await e.tarea("Por lote", e.alfa, e.empleado, e.empleado);
    const r = await como(context, e.empleado);

    const mov = await r.post(`${BASE}/api/tareas/${a}/mover`, { data: { status: "Completado", expected_updated_at: await updatedAt(a) } });
    expect(mov.status(), await mov.text()).toBe(200);
    expect((await fila(a)).done_at).not.toBeNull();

    const lote = await r.post(`${BASE}/api/tareas/masivo`, { data: { task_ids: [a, b], status: "Completado" } });
    expect(lote.status(), await lote.text()).toBe(200);
    const doneA = (await fila(a)).done_at;
    expect(doneA).not.toBeNull(); // ya estaba cerrada: conserva su fecha
    expect((await fila(b)).done_at).not.toBeNull();

    const reabre = await r.post(`${BASE}/api/tareas/masivo`, { data: { task_ids: [a, b], status: "Pendiente" } });
    expect(reabre.status(), await reabre.text()).toBe(200);
    expect((await fila(a)).done_at).toBeNull();
    expect((await fila(b)).done_at).toBeNull();
  });
});

test.describe("revisor y aprobacion", () => {
  test("el revisor no puede ser quien hace la tarea ni alguien de otra unidad", async ({ context }) => {
    const e = await escenario("rev-valido");
    const t = await e.tarea("Con revisor", e.alfa, e.empleado, e.empleado);
    const r = await como(context, e.empleado);

    const propio = await r.put(`${BASE}/api/tareas/${t}`, { data: { reviewer_id: e.empleado } });
    expect(propio.status()).toBe(400);

    // Mismo mensaje para quien no existe que para quien esta fuera de la unidad: no confirma que existe.
    const fuera = await r.put(`${BASE}/api/tareas/${t}`, { data: { reviewer_id: e.ajeno } });
    const inexistente = await r.put(`${BASE}/api/tareas/${t}`, { data: { reviewer_id: 99999999 } });
    expect(fuera.status()).toBe(400);
    expect(inexistente.status()).toBe(400);
    expect((await fuera.json()).error).toBe((await inexistente.json()).error);
    expect((await fila(t)).reviewer_id).toBeNull();

    const bien = await r.put(`${BASE}/api/tareas/${t}`, { data: { reviewer_id: e.companero } });
    expect(bien.status(), await bien.text()).toBe(200);
    expect((await bien.json()).tarea).toMatchObject({ revisorId: e.companero, revisor: expect.stringContaining("companero") });
  });

  test("con revisor, quien hace la tarea no puede cerrarla; pasa a revision y el revisor la cierra", async ({ context }) => {
    const e = await escenario("rev-cierre");
    const t = await e.tarea("Necesita visto bueno", e.alfa, e.empleado, e.empleado);
    await sql("UPDATE tasks SET reviewer_id = $1 WHERE id = $2", [e.companero, t]);
    const r = await como(context, e.empleado);

    const cerrar = await r.put(`${BASE}/api/tareas/${t}`, { data: { status: "Completado", expected_updated_at: await updatedAt(t) } });
    expect(cerrar.status()).toBe(403);
    const mover = await r.post(`${BASE}/api/tareas/${t}/mover`, { data: { status: "Completado", expected_updated_at: await updatedAt(t) } });
    expect(mover.status()).toBe(403);
    const lote = await r.post(`${BASE}/api/tareas/masivo`, { data: { task_ids: [t], status: "Completado" } });
    expect(lote.status()).toBe(403);
    expect((await sql<{ status: string }>("SELECT status FROM tasks WHERE id = $1", [t]))[0].status).toBe("Pendiente");
    expect((await fila(t)).done_at).toBeNull();

    const revision = await r.put(`${BASE}/api/tareas/${t}`, { data: { status: "En Revisión", expected_updated_at: await updatedAt(t) } });
    expect(revision.status(), await revision.text()).toBe(200);

    const revisor = await como(context, e.companero);
    const ok = await revisor.put(`${BASE}/api/tareas/${t}`, { data: { status: "Completado", expected_updated_at: await updatedAt(t) } });
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await fila(t)).done_at).not.toBeNull();
  });

  test("quien lidera la unidad cierra aunque no sea el revisor", async ({ context }) => {
    const e = await escenario("rev-lider");
    const t = await e.tarea("La cierra el lider", e.alfa, e.companero, e.companero);
    await sql("UPDATE tasks SET reviewer_id = $1 WHERE id = $2", [e.empleado, t]);
    // El empleado es el revisor; quien cierra es un lider de la unidad que no es ni asignado ni revisor.
    await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [e.ajeno, e.alfa]);
    const lider = await como(context, e.ajeno);
    const res = await lider.put(`${BASE}/api/tareas/${t}`, { data: { status: "Completado", expected_updated_at: await updatedAt(t) } });
    expect(res.status(), await res.text()).toBe(200);
  });

  test("quitar o cambiar un revisor ajeno exige ser el revisor o liderar; asi no se salta la aprobacion", async ({ context }) => {
    const e = await escenario("rev-quitar");
    const t = await e.tarea("Con revisor", e.alfa, e.empleado, e.empleado);
    await sql("UPDATE tasks SET reviewer_id = $1 WHERE id = $2", [e.companero, t]);

    const asignado = await como(context, e.empleado);
    const quitar = await asignado.put(`${BASE}/api/tareas/${t}`, { data: { reviewer_id: "" } });
    expect(quitar.status()).toBe(403);
    expect((await fila(t)).reviewer_id).toBe(e.companero);

    const revisor = await como(context, e.companero);
    const suelta = await revisor.put(`${BASE}/api/tareas/${t}`, { data: { reviewer_id: "" } });
    expect(suelta.status(), await suelta.text()).toBe(200);
    expect((await fila(t)).reviewer_id).toBeNull();
  });

  test("no se puede reasignar la tarea a su propio revisor", async ({ context }) => {
    const e = await escenario("rev-reasignar");
    const t = await e.tarea("Con revisor", e.alfa, e.empleado, e.empleado);
    await sql("UPDATE tasks SET reviewer_id = $1 WHERE id = $2", [e.companero, t]);
    const r = await como(context, e.empleado);
    const res = await r.put(`${BASE}/api/tareas/${t}`, { data: { assignee_id: e.companero } });
    expect(res.status()).toBe(400);
  });
});

test.describe("pase de la tarea", () => {
  test("se estiman horas, se elige revisor y se explica un bloqueo", async ({ page, context }) => {
    const e = await escenario("ui-seg");
    const titulo = `Seguimiento ${e.sufijo}`;
    const id = await e.tarea(titulo, e.alfa, e.empleado, e.empleado);
    await entrarComo(context, e.empleado);
    await page.goto(`${BASE}/tareas?tarea=${id}`);
    const pase = page.getByRole("article", { name: `Tarea: ${titulo}` });
    await expect(pase).toBeVisible({ timeout: 20_000 });

    const horas = pase.getByLabel("Horas estimadas");
    await horas.fill("6.5");
    await horas.blur();
    await expect.poll(async () => (await fila(id)).estimated_hours).toBe(6.5);

    // Quien hace la tarea no aparece entre los posibles revisores.
    const revisor = pase.getByLabel("Revisor");
    await expect(revisor.locator("option", { hasText: `empleado.${e.sufijo}` })).toHaveCount(0);
    await revisor.selectOption({ label: `companero.${e.sufijo}` });
    await expect.poll(async () => (await fila(id)).reviewer_id).toBe(e.companero);

    await expect(pase.getByLabel("Motivo del bloqueo")).toHaveCount(0);
    await pase.getByRole("radio", { name: "Bloqueado" }).click();
    const motivo = pase.getByLabel("Motivo del bloqueo");
    await expect(motivo).toBeVisible();
    await motivo.fill("Espera la base del cliente");
    await motivo.blur();
    await expect.poll(async () => (await fila(id)).block_reason).toBe("Espera la base del cliente");
  });

  test("con revisor ajeno, Completado y Completar quedan deshabilitados; el revisor si puede", async ({ page, context }) => {
    const e = await escenario("ui-aprob");
    const titulo = `Aprobacion ${e.sufijo}`;
    const id = await e.tarea(titulo, e.alfa, e.empleado, e.empleado);
    await sql("UPDATE tasks SET reviewer_id = $1 WHERE id = $2", [e.companero, id]);

    await entrarComo(context, e.empleado);
    await page.goto(`${BASE}/tareas?tarea=${id}`);
    let pase = page.getByRole("article", { name: `Tarea: ${titulo}` });
    await expect(pase).toBeVisible({ timeout: 20_000 });
    await expect(pase.getByRole("radio", { name: "Completado" })).toBeDisabled();
    await expect(pase.getByRole("button", { name: "Completar", exact: true })).toBeDisabled();
    await expect(pase.getByRole("radio", { name: "En Revisión" })).toBeEnabled();
    await expect(pase.getByText(`La cierra companero.${e.sufijo}`).first()).toBeVisible();
    // Tampoco puede quitar al revisor: la celda es de solo lectura.
    await expect(pase.getByLabel("Revisor")).toHaveCount(0);

    await entrarComo(context, e.companero);
    await page.goto(`${BASE}/tareas?tarea=${id}&alcance=unidad`);
    pase = page.getByRole("article", { name: `Tarea: ${titulo}` });
    await expect(pase).toBeVisible({ timeout: 20_000 });
    await expect(pase.getByRole("radio", { name: "Completado" })).toBeEnabled();
    await pase.getByRole("radio", { name: "Completado" }).click();
    await expect.poll(async () => (await fila(id)).done_at).not.toBeNull();
  });
});

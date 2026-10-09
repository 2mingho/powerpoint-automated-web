import { test } from "@playwright/test";
import { entrarComo, escenario, expect, soloEscritorio, sql } from "./apoyo";

test.beforeEach(() => {
  test.skip(soloEscritorio(test.info()), "contrato de seguridad: una pasada basta");
  test.setTimeout(120_000);
});

/*
 * Cerrar en el tablero una tarea que sigue bloqueada avisa de que la bloquea.
 * El aviso nombraba tambien las bloqueadoras de otra unidad: el titulo de una
 * tarea que la persona no puede ver. Ahora solo se cuentan.
 */
/*
 * Borrar una serie recurrente desde la madre borraba todas sus hijas, tambien
 * las que se habian reasignado a otra unidad y quien borra ya no puede ver ni
 * editar. Solo caen las hijas que puede editar.
 */
test("borrar la serie no alcanza a hijas de otra unidad", async ({ context }) => {
  const e = await escenario("serie");
  const madre = await e.tarea("Serie madre", e.alfa, e.empleado, e.empleado);
  const propia = await e.tarea("Serie hija propia", e.alfa, e.empleado, e.empleado);
  const ajena = await e.tarea("Serie hija ajena", e.beta, e.empleado, e.ajeno);
  await sql("UPDATE tasks SET parent_task_id = $1, is_recurrent = true WHERE id = ANY($2::int[])", [madre, [propia, ajena]]);
  await entrarComo(context, e.empleado);
  expect((await context.request.get(`/api/tareas/${ajena}`)).status()).toBe(404);
  const r = await context.request.delete(`/api/tareas/${madre}?serie=true`);
  expect(r.status()).toBe(200);
  expect((await r.json()).borradas).toBe(2);
  const estado = await sql<{ id: number; borrada: boolean }>("SELECT id, deleted_at IS NOT NULL AS borrada FROM tasks WHERE id = ANY($1::int[]) ORDER BY id", [[madre, propia, ajena]]);
  expect(estado.map((x) => x.borrada)).toEqual([true, true, false]);
});

test("el aviso de bloqueo al mover no nombra tareas que no se ven", async ({ context }) => {
  const e = await escenario("bloqueo");
  const propia = await e.tarea("Entrega propia", e.alfa, e.empleado, e.empleado);
  const previaVisible = await e.tarea("Previa visible", e.alfa, e.empleado, e.companero);
  const secreta = await e.tarea(`Fusion secreta ${e.sufijo}`, e.beta, e.ajeno, e.ajeno);
  for (const b of [previaVisible, secreta]) {
    await sql("INSERT INTO task_dependencies (blocker_task_id, blocked_task_id, created_at) VALUES ($1, $2, now())", [b, propia]);
  }
  await entrarComo(context, e.empleado);
  const r = await context.request.post(`/api/tareas/${propia}/mover`, { data: { status: "Completado" } });
  expect(r.status()).toBe(200);
  const { aviso } = await r.json();
  expect(aviso).toContain("Previa visible");
  expect(aviso).not.toContain("Fusion secreta");
  expect(aviso).toContain("1 que no puedes ver");
});

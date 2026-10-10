import { expect, test, type APIRequestContext } from "@playwright/test";
import { BASE, escenario, HOY, sql, sumarDias, updatedAt, entrarComo } from "./apoyo";

/*
 * Contratos de la API de tareas que no pueden romperse (portados de
 * tests/test_bandeja_tareas.py, test_tablero_tareas.py y la parte de tareas
 * de test_security_permissions.py). Cada prueba crea su propio escenario.
 */

test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio", "La API se prueba una vez, en escritorio."); });

type Esc = Awaited<ReturnType<typeof escenario>>;

async function como(contexto: import("@playwright/test").BrowserContext, userId: number) {
  await entrarComo(contexto, userId);
  return contexto.request;
}

const ids = async (r: APIRequestContext, url: string) => {
  const res = await r.get(`${BASE}${url}`);
  expect(res.status(), await res.text()).toBe(200);
  return new Set(((await res.json()).tareas as Array<{ id: number }>).map((t) => t.id));
};

test.describe("aislamiento entre unidades", () => {
  let e: Esc;
  let propia: number, ajena: number, tagAlfa: number, tagBeta: number;

  test.beforeEach(async () => {
    e = await escenario("aisl");
    propia = await e.tarea("Propia", e.alfa, e.empleado, e.empleado);
    ajena = await e.tarea("De Beta", e.beta, e.ajeno, e.ajeno);
    tagAlfa = await e.etiqueta("Cliente", e.alfa);
    tagBeta = await e.etiqueta("Interna", e.beta);
  });

  test("la lista, el tablero y el calendario no enseñan la otra unidad", async ({ context }) => {
    const r = await como(context, e.empleado);
    for (const url of ["/api/tareas?alcance=unidad", "/api/tareas/tablero?alcance=unidad", `/api/tareas?alcance=unidad&desde=${HOY}&hasta=${sumarDias(HOY, 30)}`]) {
      const vistos = await ids(r, url);
      expect(vistos.has(propia)).toBe(true);
      expect(vistos.has(ajena)).toBe(false);
    }
    const contadores = await (await r.get(`${BASE}/api/tareas/contadores?alcance=unidad`)).json();
    expect(contadores).toEqual({ vencidas: 0, hoy: 0, enCurso: 0, bloqueadas: 0 });
  });

  test("detalle, edición, mover, borrar y subrecursos de otra unidad responden 404 sin datos", async ({ context }) => {
    const r = await como(context, e.empleado);
    const pruebas = [
      r.get(`${BASE}/api/tareas/${ajena}`),
      r.put(`${BASE}/api/tareas/${ajena}`, { data: { title: "No" } }),
      r.post(`${BASE}/api/tareas/${ajena}/mover`, { data: { status: "En Progreso" } }),
      r.delete(`${BASE}/api/tareas/${ajena}`),
      r.get(`${BASE}/api/tareas/${ajena}/comentarios`),
      r.post(`${BASE}/api/tareas/${ajena}/comentarios`, { data: { body: "hola" } }),
      r.get(`${BASE}/api/tareas/${ajena}/checklist`),
      r.put(`${BASE}/api/tareas/${ajena}/etiquetas`, { data: { tag_ids: [] } }),
      r.get(`${BASE}/api/tareas/${ajena}/dependencias`),
      r.delete(`${BASE}/api/tareas/${ajena}/observadores/${e.ajeno}`),
      r.get(`${BASE}/api/tareas/99999999`),
    ];
    for (const res of await Promise.all(pruebas)) {
      expect(res.status()).toBe(404);
      const cuerpo = await res.text();
      expect(cuerpo).not.toContain("De Beta");
    }
    // Nada cambió en la tarea ajena.
    const [fila] = await sql<{ title: string; status: string; deleted_at: Date | null }>("SELECT title, status, deleted_at FROM tasks WHERE id = $1", [ajena]);
    expect(fila).toMatchObject({ title: "De Beta", status: "Pendiente", deleted_at: null });
  });

  test("operaciones masivas ignoran lo que no se ve", async ({ context }) => {
    const r = await como(context, e.empleado);
    const res = await r.post(`${BASE}/api/tareas/masivo`, { data: { accion: "editar", task_ids: [propia, ajena], status: "En Progreso" } });
    expect(res.status()).toBe(200);
    expect((await res.json()).afectadas).toBe(1);
    expect((await sql<{ status: string }>("SELECT status FROM tasks WHERE id = $1", [ajena]))[0].status).toBe("Pendiente");
    expect((await r.post(`${BASE}/api/tareas/masivo`, { data: { accion: "borrar", task_ids: [ajena] } })).status()).toBe(404);
  });

  test("no se asigna a alguien de otra unidad", async ({ context }) => {
    const r = await como(context, e.empleado);
    const res = await r.post(`${BASE}/api/tareas`, { data: { title: "x", assignee_id: e.ajeno, due_date: HOY } });
    expect(res.status()).toBe(400);
    expect((await r.put(`${BASE}/api/tareas/${propia}`, { data: { assignee_id: e.ajeno } })).status()).toBe(400);
  });

  test("etiquetas: las de otra unidad ni se ven ni se editan, y se conservan al fijar las propias", async ({ context }) => {
    const r = await como(context, e.empleado);
    const lista = (await (await r.get(`${BASE}/api/tareas/etiquetas`)).json()).etiquetas as Array<{ id: number }>;
    expect(lista.some((t) => t.id === tagBeta)).toBe(false);
    expect((await r.put(`${BASE}/api/tareas/etiquetas/${tagBeta}`, { data: { nombre: "x" } })).status()).toBe(404);
    expect((await r.delete(`${BASE}/api/tareas/etiquetas/${tagBeta}`)).status()).toBe(404);
    expect((await r.put(`${BASE}/api/tareas/${propia}/etiquetas`, { data: { tag_ids: [tagBeta] } })).status()).toBe(400);

    // Una tarea compartida puede llevar una etiqueta de otro equipo: quien no la ve no la borra.
    await sql("INSERT INTO task_tag_links (task_id, tag_id) VALUES ($1, $2)", [propia, tagBeta]);
    const res = await r.put(`${BASE}/api/tareas/${propia}/etiquetas`, { data: { tag_ids: [tagAlfa] } });
    expect(res.status()).toBe(200);
    const enlaces = await sql<{ tag_id: number }>("SELECT tag_id FROM task_tag_links WHERE task_id = $1 ORDER BY tag_id", [propia]);
    expect(enlaces.map((x) => x.tag_id).sort()).toEqual([tagAlfa, tagBeta].sort());
  });

  test("etiquetas: crear en la propia unidad, sin duplicados y con color del catálogo", async ({ context }) => {
    const r = await como(context, e.empleado);
    const res = await r.post(`${BASE}/api/tareas/etiquetas`, { data: { nombre: `Urgente  ${e.sufijo}`, color: "alerta" } });
    expect(res.status()).toBe(201);
    const tag = (await res.json()).etiqueta;
    expect(tag.nombre).toBe(`Urgente ${e.sufijo}`);
    expect(tag.unidadId).toBe(e.alfa);
    expect((await r.post(`${BASE}/api/tareas/etiquetas`, { data: { nombre: `URGENTE ${e.sufijo}` } })).status()).toBe(409);
    expect((await r.post(`${BASE}/api/tareas/etiquetas`, { data: { nombre: "x", color: "#ff0000" } })).status()).toBe(400);
    expect((await r.post(`${BASE}/api/tareas/etiquetas`, { data: { nombre: "x", area_id: e.beta } })).status()).toBe(403);
  });

  test("dependencias con una tarea invisible no se crean y solo se cuentan", async ({ context }) => {
    const r = await como(context, e.empleado);
    expect((await r.post(`${BASE}/api/tareas/${propia}/dependencias`, { data: { tipo: "blocked_by", task_id: ajena } })).status()).toBe(404);
    await sql("INSERT INTO task_dependencies (blocker_task_id, blocked_task_id, created_at) VALUES ($1, $2, now())", [ajena, propia]);
    const deps = await (await r.get(`${BASE}/api/tareas/${propia}/dependencias`)).json();
    expect(deps.bloqueadaPor).toEqual([]);
    expect(deps.ocultasBloqueadaPor).toBe(1);
    expect(JSON.stringify(deps)).not.toContain("De Beta");
  });
});

test("chips de alcance: solo estrechan, nunca amplían", async ({ context }) => {
  const e = await escenario("chips");
  const mia = await e.tarea("Mía", e.alfa, e.companero, e.empleado);
  const creada = await e.tarea("Creada por mí", e.alfa, e.empleado, e.companero);
  const otra = await e.tarea("Del compañero", e.alfa, e.companero, e.companero);
  const ajenaCreada = await e.tarea("Creada por mí en Beta", e.beta, e.empleado, e.ajeno);
  const r = await como(context, e.empleado);

  const mias = await ids(r, "/api/tareas?alcance=mias");
  const creadas = await ids(r, "/api/tareas?alcance=creadas");
  const unidad = await ids(r, "/api/tareas?alcance=unidad");
  expect(mias.has(mia) && !mias.has(creada) && !mias.has(otra)).toBe(true);
  expect(creadas.has(creada) && !creadas.has(mia)).toBe(true);
  expect([mia, creada, otra].every((id) => unidad.has(id))).toBe(true);
  // Haberla creado no da acceso a una tarea de otra unidad.
  for (const s of [mias, creadas, unidad]) expect(s.has(ajenaCreada)).toBe(false);
  // Alcance desconocido = el por defecto (asignadas a mí).
  expect(await ids(r, "/api/tareas?alcance=todo")).toEqual(mias);
});

test("conflicto 409 al editar y al cambiar de columna con una versión vieja", async ({ context }) => {
  const e = await escenario("conf");
  const t = await e.tarea("Con conflicto", e.alfa, e.empleado, e.empleado);
  const r = await como(context, e.empleado);
  const vieja = await updatedAt(t);
  await sql("UPDATE tasks SET title = 'Cambiada en otra sesión', updated_at = now() + interval '1 second' WHERE id = $1", [t]);

  const put = await r.put(`${BASE}/api/tareas/${t}`, { data: { title: "Mi cambio viejo", expected_updated_at: vieja } });
  expect(put.status()).toBe(409);
  const datos = await put.json();
  expect(datos.error).toContain("modificada por otro usuario");
  expect(datos.tarea.titulo).toBe("Cambiada en otra sesión");

  const mover = await r.post(`${BASE}/api/tareas/${t}/mover`, { data: { status: "En Progreso", expected_updated_at: "2000-01-01T00:00:00.000Z" } });
  expect(mover.status()).toBe(409);
  expect((await sql<{ status: string }>("SELECT status FROM tasks WHERE id = $1", [t]))[0].status).toBe("Pendiente");

  // Con la versión vigente sí, y deshacer encadenado con la nueva versión también.
  const actual = await updatedAt(t);
  const ok = await r.put(`${BASE}/api/tareas/${t}`, { data: { status: "En Progreso", expected_updated_at: actual } });
  expect(ok.status()).toBe(200);
  const nueva = (await ok.json()).tarea.actualizada;
  expect((await r.put(`${BASE}/api/tareas/${t}`, { data: { status: "Pendiente", expected_updated_at: nueva } })).status()).toBe(200);
});

test("reordenar en el tablero no toca updated_at y deja el orden pedido", async ({ context }) => {
  const e = await escenario("orden");
  const p1 = await e.tarea("P1", e.alfa, e.empleado, e.empleado, "Pendiente", sumarDias(HOY, 1));
  const p2 = await e.tarea("P2", e.alfa, e.empleado, e.companero, "Pendiente", sumarDias(HOY, 2));
  const p3 = await e.tarea("P3", e.alfa, e.empleado, e.empleado, "Pendiente", sumarDias(HOY, 3));
  const r = await como(context, e.empleado);
  const columna = async () => ((await (await r.get(`${BASE}/api/tareas/tablero?alcance=unidad`)).json()).tareas as Array<{ id: number; estado: string }>)
    .filter((t) => t.estado === "Pendiente" && [p1, p2, p3].includes(t.id)).map((t) => t.id);
  expect(await columna()).toEqual([p1, p2, p3]);

  const antes = await sql<{ id: number; u: Date }>("SELECT id, updated_at AS u FROM tasks WHERE area_id = $1 ORDER BY id", [e.alfa]);
  // P3 arriba del todo: nadie tenia posición y se renumera la columna.
  expect((await r.post(`${BASE}/api/tareas/${p3}/mover`, { data: { status: "Pendiente", siguiente_id: p1 } })).status()).toBe(200);
  expect(await columna()).toEqual([p3, p1, p2]);
  // P2 entre P3 y P1: cabe en el hueco.
  expect((await r.post(`${BASE}/api/tareas/${p2}/mover`, { data: { status: "Pendiente", anterior_id: p3, siguiente_id: p1 } })).status()).toBe(200);
  expect(await columna()).toEqual([p3, p2, p1]);
  const despues = await sql<{ id: number; u: Date }>("SELECT id, updated_at AS u FROM tasks WHERE area_id = $1 ORDER BY id", [e.alfa]);
  expect(despues.map((x) => x.u.toISOString())).toEqual(antes.map((x) => x.u.toISOString()));

  // Cambiar de columna sí es una edición: avisa al observador y sube updated_at.
  await sql("INSERT INTO task_watchers (task_id, user_id, created_at) VALUES ($1, $2, now())", [p1, e.companero]);
  const mov = await r.post(`${BASE}/api/tareas/${p1}/mover`, { data: { status: "En Progreso" } });
  expect(mov.status()).toBe(200);
  expect((await updatedAt(p1)) > antes.find((x) => x.id === p1)!.u.toISOString()).toBe(true);
  expect((await sql("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'task_watching' AND entity_id = $2", [e.companero, p1])).length).toBe(1);
  expect((await r.post(`${BASE}/api/tareas/${p1}/mover`, { data: { status: "Inventado" } })).status()).toBe(400);
});

test("dependencias: ciclos, duplicados y autodependencia rechazados; cerrar avisa", async ({ context }) => {
  const e = await escenario("ciclo");
  const [p1, p2, p3] = [await e.tarea("P1", e.alfa, e.empleado, e.empleado), await e.tarea("P2", e.alfa, e.empleado, e.empleado), await e.tarea("P3", e.alfa, e.empleado, e.empleado)];
  const r = await como(context, e.empleado);
  const dep = (a: number, b: number, tipo = "blocked_by") => r.post(`${BASE}/api/tareas/${a}/dependencias`, { data: { tipo, task_id: b } });
  expect((await dep(p2, p1)).status()).toBe(201);
  expect((await dep(p3, p2)).status()).toBe(201);
  // p1 -> p2 -> p3: que p3 vaya antes que p1 cerraría el círculo.
  const ciclo = await dep(p1, p3);
  expect(ciclo.status()).toBe(400);
  expect((await ciclo.json()).error).toContain("círculo");
  expect((await dep(p2, p1)).status()).toBe(409);
  expect((await dep(p1, p1, "blocks")).status()).toBe(400);

  const tarjeta = async (id: number) => ((await (await r.get(`${BASE}/api/tareas/tablero?alcance=unidad`)).json()).tareas as Array<{ id: number; bloqueadaPorAbiertas: number }>).find((t) => t.id === id)!;
  expect((await tarjeta(p2)).bloqueadaPorAbiertas).toBe(1);
  const cerrar = await r.post(`${BASE}/api/tareas/${p2}/mover`, { data: { status: "Completado" } });
  expect((await cerrar.json()).aviso).toContain("P1");
  // p3 espera a p2, que ya está cerrada: deja de contar como bloqueo.
  expect((await tarjeta(p3)).bloqueadaPorAbiertas).toBe(0);
});

test("CSV: la vista previa marca las filas inválidas y solo se importan las válidas", async ({ context }) => {
  const e = await escenario("csv");
  // Importar es para quien lidera: el empleado pasa a liderar Alfa.
  await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [e.empleado, e.alfa]);
  const r = await como(context, e.empleado);
  const lunes = (() => { let d = sumarDias(HOY, 7); while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = sumarDias(d, 1); return d; })();
  const sabado = (() => { let d = HOY; while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 6) d = sumarDias(d, 1); return d; })();
  const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
  const cab = "Fecha De inicio;Fecha De finalizacion;Fecha De entrega;Director o Gerencia;Cliente;Titulo;Solicitado por;Asignar a;Descripcion;Tipo de Presupuesto;Prioridad;Recurrencia";
  const csv = [
    cab,
    `;;${mdy(lunes)};Dir;Cliente A;Válida ${e.sufijo};Ana;companero.${e.sufijo};;;Alta;No`,
    `;;${mdy(lunes)};;;;;companero.${e.sufijo};;;;No`, // sin título
    `;;${mdy(sabado)};;Cliente;Fin de semana ${e.sufijo};R;companero.${e.sufijo};;;;No`, // sábado
    `;;${mdy(lunes)};;Cliente;Ajena ${e.sufijo};R;ajeno.${e.sufijo};;;;No`, // fuera del ámbito
    `;;31/31/2026;;Cliente;Fecha mala ${e.sufijo};R;companero.${e.sufijo};;;;Anual`,
  ].join("\n");

  const previa = await r.post(`${BASE}/api/tareas/csv/vista-previa`, { multipart: { csv_file: { name: "tareas.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") } } });
  expect(previa.status(), await previa.text()).toBe(200);
  const p = await previa.json();
  expect(p.total_rows).toBe(5);
  expect(p.error_rows).toBe(4);
  const codigos = (p.errors as Array<{ row: number; code: string }>).map((x) => `${x.row}:${x.code}`);
  expect(codigos).toEqual(expect.arrayContaining(["3:required", "4:weekend_not_allowed", "5:assignee_not_found", "6:invalid_date", "6:invalid_recurrence"]));

  const imp = await r.post(`${BASE}/api/tareas/csv/importar`, { data: { rows: p.rows.map((f: { row_number: number; fields: unknown }) => ({ row_number: f.row_number, fields: f.fields })) } });
  const res = await imp.json();
  expect(res).toMatchObject({ total_rows: 5, imported_rows: 1, failed_rows: 4 });
  expect((res.remaining_rows as unknown[]).length).toBe(4);
  expect((await sql("SELECT 1 FROM tasks WHERE title = $1 AND assignee_id = $2", [`Válida ${e.sufijo}`, e.companero])).length).toBe(1);
  expect((await sql("SELECT 1 FROM tasks WHERE title LIKE $1", [`%${e.sufijo}`])).length).toBe(1);

  // Cabeceras que no cuadran: 400 con el detalle.
  const mala = await r.post(`${BASE}/api/tareas/csv/vista-previa`, { multipart: { csv_file: { name: "x.csv", mimeType: "text/csv", buffer: Buffer.from("Titulo,Otra\nx,y\n") } } });
  expect(mala.status()).toBe(400);
  expect((await mala.json()).details.unexpected_headers).toEqual(["Otra"]);
});

test("observar: compartida se ve pero no se edita; salir de una solo observada la pierde de vista", async ({ context }) => {
  const e = await escenario("obs");
  const t = await e.tarea("Compartida", e.alfa, e.empleado, e.empleado);
  const r = await como(context, e.empleado);
  // Observador de otra unidad: la tarea pasa a compartida.
  expect((await r.post(`${BASE}/api/tareas/${t}/observadores`, { data: { user_id: e.ajeno } })).status()).toBe(200);
  expect((await sql<{ visibility: string }>("SELECT visibility FROM tasks WHERE id = $1", [t]))[0].visibility).toBe("shared");
  expect((await sql("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'task_watching' AND entity_id = $2", [e.ajeno, t])).length).toBe(1);

  await context.clearCookies();
  const r2 = await como(context, e.ajeno);
  const det = await r2.get(`${BASE}/api/tareas/${t}`);
  expect(det.status()).toBe(200);
  expect((await det.json()).tarea.puedeEditar).toBe(false);
  expect((await r2.put(`${BASE}/api/tareas/${t}`, { data: { title: "No" } })).status()).toBe(403);
  expect((await r2.post(`${BASE}/api/tareas/${t}/comentarios`, { data: { body: "No" } })).status()).toBe(403);
  const salir = await r2.delete(`${BASE}/api/tareas/${t}/observadores/${e.ajeno}`);
  expect(await salir.json()).toEqual({ sigueViendo: false });
  expect((await r2.get(`${BASE}/api/tareas/${t}`)).status()).toBe(404);
});

test("comentar avisa a asignado, creador y mencionados del ámbito, nunca al autor", async ({ context }) => {
  const e = await escenario("coment");
  const t = await e.tarea("Con comentarios", e.alfa, e.companero, e.empleado);
  const r = await como(context, e.empleado);
  const res = await r.post(`${BASE}/api/tareas/${t}/comentarios`, { data: { body: `Hola @companero.${e.sufijo} y @ajeno.${e.sufijo}` } });
  expect(res.status()).toBe(201);
  const avisos = await sql<{ user_id: number; kind: string }>("SELECT user_id, kind FROM notifications WHERE entity_id = $1 ORDER BY kind", [t]);
  expect(avisos).toEqual(expect.arrayContaining([{ user_id: e.companero, kind: "mention" }, { user_id: e.companero, kind: "task_comment" }]));
  expect(avisos.some((a) => a.user_id === e.ajeno || a.user_id === e.empleado)).toBe(false);
});

test("sin la herramienta de tareas la API responde 403", async ({ context }) => {
  const e = await escenario("sinherr");
  await sql("UPDATE users SET allowed_tools = '[\"reports\"]' WHERE id = $1", [e.empleado]);
  const r = await como(context, e.empleado);
  expect((await r.get(`${BASE}/api/tareas`)).status()).toBe(403);
});

test("ventana alrededor de hoy: las más cercanas por cada lado, por entrega, y se amplía por lados", async ({ context }) => {
  const e = await escenario("ventana");
  // 5 vencidas (de 1 a 5 días atrás), una de hoy y 5 por venir (de 1 a 5 días), todas mías.
  const atras = [];
  for (let d = 5; d >= 1; d--) atras.push(await e.tarea(`Atrás ${d}`, e.alfa, e.empleado, e.empleado, "Pendiente", sumarDias(HOY, -d)));
  const hoy = await e.tarea("Hoy", e.alfa, e.empleado, e.empleado, "Pendiente", HOY);
  const adelante = [];
  for (let d = 1; d <= 5; d++) adelante.push(await e.tarea(`Adelante ${d}`, e.alfa, e.empleado, e.empleado, "Pendiente", sumarDias(HOY, d)));
  const r = await como(context, e.empleado);
  const pedir = async (q: string) => {
    const res = await r.get(`${BASE}/api/tareas?alcance=mias&${q}`);
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()) as { tareas: { id: number; entrega: string }[]; hayAntes: boolean; hayDespues: boolean; contadores: { vencidas: number } };
  };

  const dos = await pedir("antes=2&despues=3");
  // Las 2 vencidas más cercanas (3 y 4... no: 2 y 1 días atrás) y hoy + 2 próximas; juntas y por entrega.
  expect(dos.tareas.map((t) => t.id)).toEqual([atras[3], atras[4], hoy, adelante[0], adelante[1]]);
  expect(dos.tareas.map((t) => t.entrega)).toEqual([...dos.tareas.map((t) => t.entrega)].sort());
  expect(dos.hayAntes).toBe(true);
  expect(dos.hayDespues).toBe(true);
  // Los contadores siguen contando todo, no solo lo que viaja.
  expect(dos.contadores.vencidas).toBe(5);

  // Ampliar solo un lado no mueve el otro.
  const masAntes = await pedir("antes=4&despues=3");
  expect(masAntes.tareas.map((t) => t.id)).toEqual([atras[1], atras[2], atras[3], atras[4], hoy, adelante[0], adelante[1]]);

  // Cuando todo cabe, no hay "ver más" por ningún lado.
  const todo = await pedir("antes=50&despues=50");
  expect(todo.tareas).toHaveLength(11);
  expect(todo.hayAntes || todo.hayDespues).toBe(false);

  // Un lado en cero no viaja, pero avisa de que hay más.
  const soloFuturo = await pedir("antes=0&despues=1");
  expect(soloFuturo.tareas.map((t) => t.id)).toEqual([hoy]);
  expect(soloFuturo.hayAntes).toBe(true);

  // Valores raros caen en el rango válido y no fallan.
  for (const q of ["antes=-1&despues=abc", "antes=99999&despues=0", "antes=1.5"]) expect((await r.get(`${BASE}/api/tareas?alcance=mias&${q}`)).status()).toBe(200);
});

test("la ventana respeta la visibilidad: no cuela tareas de otra unidad por estar cerca de hoy", async ({ context }) => {
  const e = await escenario("ventanavis");
  const propia = await e.tarea("Propia", e.alfa, e.empleado, e.empleado, "Pendiente", HOY);
  const ajena = await e.tarea("Ajena", e.beta, e.ajeno, e.ajeno, "Pendiente", HOY);
  const r = await como(context, e.empleado);
  const res = await (await r.get(`${BASE}/api/tareas?alcance=unidad&antes=50&despues=50`)).json() as { tareas: { id: number }[] };
  const vistos = new Set(res.tareas.map((t) => t.id));
  expect(vistos.has(propia)).toBe(true);
  expect(vistos.has(ajena)).toBe(false);
});

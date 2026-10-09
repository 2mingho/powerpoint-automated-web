import { expect, test } from "@playwright/test";
import { api, consulta, idDe, idSolicitud, sembrar } from "./ayuda";

/*
 * Contratos de servidor del modulo (tests/test_solicitudes_observacion.py,
 * test_security_permissions.py y test_tour.py de Flask), sobre la base
 * comun (e2e/semilla.ts); cada bateria vuelve a sembrar solo las solicitudes.
 */
test.describe.configure({ mode: "serial" });
test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio", "Pruebas de API: una vez basta"); });
test.beforeAll(() => sembrar());

type Sol = { id: number; titulo: string; estado: string; tareaId: number | null; puedeResolver: boolean; puedeCancelar: boolean };

test.describe("aislamiento", () => {
  test("Recibidas solo muestra lo dirigido al ambito; quien no lo tiene no ve ni el conteo", async () => {
    const lider = await api("carlos@equipo.test");
    const r = await (await lider.get("/api/solicitudes?bandeja=recibidas")).json();
    const titulos = r.solicitudes.map((s: Sol) => s.titulo);
    expect(titulos).toContain("Informe de menciones de octubre para Banco Popular");
    expect(titulos).not.toContain("Guion para video institucional"); // va a Comunicación

    const dis = await api("miembro.dis@local.test");
    const d = await (await dis.get("/api/solicitudes?bandeja=recibidas")).json();
    expect(d.solicitudes.map((s: Sol) => s.titulo)).not.toContain("Informe de menciones de octubre para Banco Popular");

    const sin = await api("sin.unidad@local.test");
    const s = await (await sin.get("/api/solicitudes?bandeja=recibidas")).json();
    expect(s.solicitudes).toEqual([]);
    expect(s.contadores.recibidas).toBe(0);
  });

  test("una solicitud ajena responde 404 sin datos, tambien al intentar resolverla", async () => {
    const id = await idSolicitud("Guion para video institucional"); // Diseño -> Comunicación
    const ajeno = await api("analista@local.test");
    const r = await ajeno.get(`/api/solicitudes/${id}`);
    expect(r.status()).toBe(404);
    expect(JSON.stringify(await r.json())).not.toContain("Guion");
    expect((await ajeno.post(`/api/solicitudes/${id}/aceptar`, { data: { responsableId: 1 } })).status()).toBe(404);
    expect((await ajeno.post(`/api/solicitudes/${id}/rechazar`, { data: { motivo: "no me toca nada" } })).status()).toBe(404);
    expect((await ajeno.get(`/api/solicitudes/${id}/asignables`)).status()).toBe(404);
  });

  test("pertenecer a la unidad destino no basta para aceptar: hay que liderarla (403)", async () => {
    const id = await idSolicitud("Informe de menciones de octubre para Banco Popular");
    const miembro = await api("analista@local.test");
    expect((await miembro.get(`/api/solicitudes/${id}`)).status()).toBe(200);
    const r = await miembro.post(`/api/solicitudes/${id}/aceptar`, { data: { responsableId: (await idDe("analista@local.test")).id } });
    expect(r.status()).toBe(403);
    const fila = (await consulta<{ status: string }>("SELECT status FROM task_requests WHERE id = $1", [id]))[0];
    expect(fila.status).toBe("Pendiente");
  });

  test("la directora resuelve lo de la unidad de su manager", async () => {
    const id = await idSolicitud("Guion para video institucional");
    const dir = await api("laura@equipo.test");
    const r = await (await dir.get(`/api/solicitudes/${id}`)).json();
    expect(r.solicitud.puedeResolver).toBe(true);
  });
});

test.describe("crear", () => {
  test("quien no tiene unidad puede solicitar y la ve en Enviadas; se avisa a los lideres con el id", async () => {
    const sin = await api("sin.unidad@local.test");
    const r = await sin.post("/api/solicitudes", { data: { titulo: "Prueba sin unidad", unidadDestinoId: (await consulta<{ id: number }>("SELECT id FROM areas WHERE name = 'Diseño'"))[0].id } });
    expect(r.status()).toBe(201);
    const { solicitud } = await r.json();
    const env = await (await sin.get("/api/solicitudes?bandeja=enviadas")).json();
    expect(env.solicitudes.map((s: Sol) => s.id)).toContain(solicitud.id);
    const avisos = await consulta<{ entity_id: number; user_id: number }>("SELECT entity_id, user_id FROM notifications WHERE kind = 'request_received' AND entity_id = $1", [solicitud.id]);
    expect(avisos.map((a) => a.user_id)).toEqual([(await idDe("lider.dis@local.test")).id]);
  });

  test("no se solicita a la propia unidad, y el desplegable no la ofrece", async () => {
    const a = await api("analista@local.test");
    const op = await (await a.get("/api/solicitudes/opciones")).json();
    expect(op.unidades.map((u: { nombre: string }) => u.nombre)).not.toContain("Data Intelligence");
    const di = (await consulta<{ id: number }>("SELECT id FROM areas WHERE name = 'Data Intelligence'"))[0].id;
    expect((await a.post("/api/solicitudes", { data: { titulo: "A mi misma", unidadDestinoId: di } })).status()).toBe(400);
  });

  test("un admin puede solicitar; una unidad sin lider la reciben los admins", async () => {
    const admin = await api("demo@local.test");
    const comercial = (await consulta<{ id: number }>("SELECT id FROM areas WHERE name = 'Comercial'"))[0].id;
    const r = await admin.post("/api/solicitudes", { data: { titulo: "Para Comercial", unidadDestinoId: comercial } });
    expect(r.status()).toBe(201);
    const { solicitud } = await r.json();
    // El admin es el actor: no se avisa a si mismo.
    const avisos = await consulta("SELECT 1 FROM notifications WHERE entity_id = $1 AND kind = 'request_received' AND user_id = $2", [solicitud.id, (await idDe("demo@local.test")).id]);
    expect(avisos).toHaveLength(0);
  });

  test("valida titulo y fecha", async () => {
    const a = await api("analista@local.test");
    expect((await a.post("/api/solicitudes", { data: { titulo: "  ", unidadDestinoId: 2 } })).status()).toBe(400);
    expect((await a.post("/api/solicitudes", { data: { titulo: "x", unidadDestinoId: 2, entrega: "2026-02-31" } })).status()).toBe(400);
  });
});

test.describe("resolver", () => {
  test("aceptar crea la tarea compartida en la unidad destino, deja al solicitante observando y avisa", async () => {
    const id = await idSolicitud("Informe de menciones de octubre para Banco Popular");
    const lider = await api("carlos@equipo.test");
    const asign = await (await lider.get(`/api/solicitudes/${id}/asignables`)).json();
    const nombres = asign.usuarios.map((u: { nombre: string }) => u.nombre);
    expect(nombres).toContain("analista");
    expect(nombres).not.toContain("Elena Castro");
    const analista = await idDe("analista@local.test");

    const r = await lider.post(`/api/solicitudes/${id}/aceptar`, { data: { responsableId: analista.id } });
    expect(r.status()).toBe(200);
    const { solicitud, tareaId } = await r.json();
    expect(solicitud.estado).toBe("Aceptada");
    expect(solicitud.tareaId).toBe(tareaId);

    const [t] = await consulta<{ visibility: string; area: string; assignee_id: number; status: string }>("SELECT visibility, area, assignee_id, status FROM tasks WHERE id = $1", [tareaId]);
    expect(t).toMatchObject({ visibility: "shared", area: "Data Intelligence", assignee_id: analista.id, status: "Pendiente" });
    const solicitante = await idDe("elena@equipo.test");
    expect(await consulta("SELECT 1 FROM task_watchers WHERE task_id = $1 AND user_id = $2", [tareaId, solicitante.id])).toHaveLength(1);
    const avisos = await consulta<{ user_id: number; kind: string; link_url: string }>("SELECT user_id, kind, link_url FROM notifications WHERE entity_type = 'task' AND entity_id = $1 ORDER BY kind", [tareaId]);
    expect(avisos).toEqual([
      { user_id: solicitante.id, kind: "request_accepted", link_url: `/tareas?tarea=${tareaId}` },
      { user_id: analista.id, kind: "task_assigned", link_url: `/tareas?tarea=${tareaId}` },
    ]);
  });

  test("el responsable tiene que ser de la unidad destino", async () => {
    const id = await idSolicitud("Monitoreo de marca para cliente nuevo");
    const lider = await api("carlos@equipo.test");
    const r = await lider.post(`/api/solicitudes/${id}/aceptar`, { data: { responsableId: (await idDe("elena@equipo.test")).id } });
    expect(r.status()).toBe(400);
  });

  test("dos aceptaciones simultaneas: una gana, la otra recibe 409 y solo hay una tarea", async () => {
    const id = await idSolicitud("Monitoreo de marca para cliente nuevo");
    const lider = await api("carlos@equipo.test");
    const admin = await api("demo@local.test");
    const responsable = (await idDe("analista@local.test")).id;
    const [a, b] = await Promise.all([
      lider.post(`/api/solicitudes/${id}/aceptar`, { data: { responsableId: responsable } }),
      admin.post(`/api/solicitudes/${id}/aceptar`, { data: { responsableId: responsable } }),
    ]);
    expect([a.status(), b.status()].sort()).toEqual([200, 409]);
    expect(await consulta("SELECT 1 FROM tasks WHERE title = 'Monitoreo de marca para cliente nuevo'")).toHaveLength(1);
    const rechazo = await lider.post(`/api/solicitudes/${id}/rechazar`, { data: { motivo: "ya no aplica" } });
    expect(rechazo.status()).toBe(409);
  });

  test("rechazar exige motivo y se lo hace llegar a quien la pidio", async () => {
    const id = await idSolicitud("Análisis de sentimiento del lanzamiento");
    const lider = await api("carlos@equipo.test");
    expect((await lider.post(`/api/solicitudes/${id}/rechazar`, { data: { motivo: "no" } })).status()).toBe(400);
    const r = await lider.post(`/api/solicitudes/${id}/rechazar`, { data: { motivo: "Ya lo cubre el informe mensual." } });
    expect(r.status()).toBe(200);
    expect((await r.json()).solicitud.estado).toBe("Rechazada");
    const [n] = await consulta<{ user_id: number; body: string }>("SELECT user_id, body FROM notifications WHERE kind = 'request_rejected' AND entity_id = $1", [id]);
    expect(n).toEqual({ user_id: (await idDe("lider.dis@local.test")).id, body: "Motivo: Ya lo cubre el informe mensual." });
  });

  test("solo quien la pidio (o un admin) la cancela", async () => {
    const id = await idSolicitud("Nota de prensa de la campaña de verano"); // analista -> Comunicación
    const lider = await api("sofia@equipo.test");
    expect((await lider.post(`/api/solicitudes/${id}/cancelar`)).status()).toBe(403);
    const colega = await api("carlos@equipo.test"); // ve las enviadas de su unidad, pero no son suyas
    expect((await colega.post(`/api/solicitudes/${id}/cancelar`)).status()).toBe(403);
    const ajeno = await api("miembro.dis@local.test");
    expect((await ajeno.post(`/api/solicitudes/${id}/cancelar`)).status()).toBe(404);
    const duena = await api("analista@local.test");
    const r = await duena.post(`/api/solicitudes/${id}/cancelar`);
    expect(r.status()).toBe(200);
    expect((await r.json()).solicitud.estado).toBe("Cancelada");
    expect((await duena.post(`/api/solicitudes/${id}/cancelar`)).status()).toBe(409);
  });

  test("sin la herramienta de tareas no se resuelve", async () => {
    await consulta("UPDATE users SET allowed_tools = '[\"reports\"]' WHERE email = 'sofia@equipo.test'");
    try {
      const id = await idSolicitud("Guion para video institucional");
      const lider = await api("sofia@equipo.test");
      expect((await lider.post(`/api/solicitudes/${id}/rechazar`, { data: { motivo: "sin herramienta" } })).status()).toBe(403);
    } finally {
      await consulta("UPDATE users SET allowed_tools = NULL WHERE email = 'sofia@equipo.test'");
    }
  });
});

test.describe("notificaciones", () => {
  test("cada uno ve, cuenta y marca solo las suyas", async () => {
    const lider = await api("carlos@equipo.test");
    const analista = await api("analista@local.test");
    const mias = await (await analista.get("/api/notificaciones")).json();
    const idsLider = (await consulta<{ id: number }>("SELECT id FROM notifications WHERE user_id = $1", [(await idDe("carlos@equipo.test")).id])).map((x) => x.id);
    expect(mias.items.some((n: { id: number }) => idsLider.includes(n.id))).toBe(false);

    const ajena = idsLider[0];
    expect((await analista.post(`/api/notificaciones/${ajena}/leida`)).status()).toBe(404);
    const [fila] = await consulta<{ read_at: Date | null }>("SELECT read_at FROM notifications WHERE id = $1", [ajena]);
    expect(fila.read_at).toBeNull();

    const antes = (await (await lider.get("/api/notificaciones/contador")).json()).noLeidas;
    expect(antes).toBeGreaterThan(0);
    expect((await lider.post(`/api/notificaciones/${ajena}/leida`)).status()).toBe(200);
    expect((await (await lider.get("/api/notificaciones/contador")).json()).noLeidas).toBe(antes - 1);

    await analista.post("/api/notificaciones/leer-todas");
    expect((await (await analista.get("/api/notificaciones/contador")).json()).noLeidas).toBe(0);
    // Marcar todas las mias no toca las del lider.
    expect((await (await lider.get("/api/notificaciones/contador")).json()).noLeidas).toBe(antes - 1);
  });

  test("los enlaces viejos de Flask se traducen a las rutas nuevas", async () => {
    const analista = await api("analista@local.test");
    const { items } = await (await analista.get("/api/notificaciones")).json();
    const enlaces = items.map((n: { enlace: string }) => n.enlace);
    expect(enlaces).toContain("/solicitudes");
    expect(enlaces.some((e: string) => e?.startsWith("/tareas?tarea="))).toBe(true);
  });

  test("sin sesion: 401", async ({ request }) => {
    expect((await request.get("/api/notificaciones")).status()).toBe(401);
    expect((await request.post("/api/tour/completado")).status()).toBe(401);
  });
});

test.describe("tour", () => {
  test("la marca es de cada usuario y se puede reiniciar", async () => {
    const nuevo = await api("nuevo@local.test");
    expect((await nuevo.post("/api/tour/completado")).status()).toBe(200);
    const [a] = await consulta<{ tour_completed_at: Date | null }>("SELECT tour_completed_at FROM users WHERE email = 'nuevo@local.test'");
    expect(a.tour_completed_at).not.toBeNull();
    const [otro] = await consulta<{ tour_completed_at: Date | null }>("SELECT tour_completed_at FROM users WHERE email = 'analista@local.test'");
    expect(otro.tour_completed_at).not.toBeNull(); // sembrado como visto; no lo toco
    expect((await nuevo.post("/api/tour/reiniciar")).status()).toBe(200);
    const [b] = await consulta<{ tour_completed_at: Date | null }>("SELECT tour_completed_at FROM users WHERE email = 'nuevo@local.test'");
    expect(b.tour_completed_at).toBeNull();
  });
});

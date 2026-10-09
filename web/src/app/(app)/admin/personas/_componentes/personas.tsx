"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Pencil, Plus, Power, UserRoundCheck } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { cx } from "@/components/ui/cx";
import { Dialogo } from "@/components/ui/dialogo";
import { CeldaEstado } from "@/components/ui/estado";
import { PanelLateral } from "@/components/ui/panel-lateral";
import { Vacio } from "@/components/ui/panel";
import { useAvisos } from "@/components/ui/avisos";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import { fFecha } from "@/lib/admin/formato";
import type { FilaUsuario, listarUsuarios, opcionesPersonas } from "@/lib/admin/consultas";
import { BuscadorDiferido, claseCelda, claseFila, Paginacion, Tabla, Th, useListaRemota } from "../../_componentes/comunes";
import { Roles } from "./roles";

type Lista = Awaited<ReturnType<typeof listarUsuarios>>;
type Opciones = Awaited<ReturnType<typeof opcionesPersonas>>;

/* Las mismas claves que HERRAMIENTAS de la sesion; aqui con nombre corto para la tabla. */
const HERRAMIENTAS: { clave: string; nombre: string; corto: string }[] = [
  { clave: "reports", nombre: "Generar reporte", corto: "Rep" },
  { clave: "classification", nombre: "Clasificación de datos", corto: "Cla" },
  { clave: "file_merge", nombre: "Unión de archivos", corto: "Uni" },
  { clave: "csv_analysis", nombre: "Análisis rápido CSV", corto: "CSV" },
  { clave: "tasks", nombre: "Gestión de tareas", corto: "Tar" },
];

export function PantallaPersonas({ inicial, opciones: opcionesIniciales, yoId, filtrosIniciales }: {
  inicial: Lista; opciones: Opciones; yoId: number; filtrosIniciales: Record<string, string>;
}) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const { datos, filtros, cambiar, recargar, cargando, error } = useListaRemota<Lista>("/api/admin/usuarios", inicial, filtrosIniciales);
  const [opciones, setOpciones] = useState(opcionesIniciales);
  const [editando, setEditando] = useState<FilaUsuario | "nueva" | null>(null);
  const [confirmar, setConfirmar] = useState<{ tipo: "expulsar" | "desactivar"; u: FilaUsuario } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const cerrar = useCallback(() => setEditando(null), []);

  const recargarTodo = async () => {
    await recargar();
    try { setOpciones(await pedirOpciones()); } catch { /* la tabla ya avisa */ }
    router.refresh();
  };

  async function accionSesion() {
    if (!confirmar) return;
    setTrabajando(true);
    try {
      if (confirmar.tipo === "expulsar") {
        await pedir(`/api/admin/usuarios/${confirmar.u.id}/expulsar`, { cuerpo: {} });
        avisar(`Sesión de ${confirmar.u.nombre} cerrada. Tendrá que volver a entrar.`, { tipo: "exito" });
      } else {
        await pedir(`/api/admin/usuarios/${confirmar.u.id}/activo`, { cuerpo: { activo: false } });
        const u = confirmar.u;
        avisar(`${u.nombre} desactivada.`, {
          tipo: "exito",
          deshacer: async () => { await pedir(`/api/admin/usuarios/${u.id}/activo`, { cuerpo: { activo: true } }); await recargarTodo(); },
        });
      }
      setConfirmar(null);
      setEditando(null);
      await recargarTodo();
    } catch (e) {
      avisar(mensajeDe(e), { tipo: "error" });
    } finally {
      setTrabajando(false);
    }
  }

  async function activar(u: FilaUsuario) {
    try {
      await pedir(`/api/admin/usuarios/${u.id}/activo`, { cuerpo: { activo: true } });
      avisar(`${u.nombre} vuelve a estar activa.`, { tipo: "exito" });
      await recargarTodo();
      setEditando(null);
    } catch (e) { avisar(mensajeDe(e), { tipo: "error" }); }
  }

  const hayFiltro = !!(filtros.q || filtros.rol || filtros.unidad || filtros.estado);
  const rolNombre = (c: string) => c === "admin" ? "Administración" : opciones.roles.find((r) => r.codigo === c)?.nombre ?? c;

  return (
    <div className="flex flex-col gap-6">
      <Tabla
        etiqueta="Personas"
        cargando={cargando}
        error={error}
        cabecera={
          <>
            <BuscadorDiferido valor={filtros.q ?? ""} onCambio={(q) => cambiar({ q })} etiqueta="Buscar por nombre o correo" placeholder="Buscar por nombre o correo" />
            <Selector aria-label="Rol" value={filtros.rol ?? ""} onChange={(e) => cambiar({ rol: e.target.value })} className="w-full sm:w-44">
              <option value="">Todos los roles</option>
              <option value="admin">Administración</option>
              {opciones.roles.map((r) => <option key={r.id} value={r.codigo}>{r.nombre}</option>)}
            </Selector>
            <Selector aria-label="Unidad" value={filtros.unidad ?? ""} onChange={(e) => cambiar({ unidad: e.target.value })} className="w-full sm:w-48">
              <option value="">Todas las unidades</option>
              <option value="sin">Sin unidad</option>
              {opciones.unidades.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </Selector>
            <Selector aria-label="Estado" value={filtros.estado ?? ""} onChange={(e) => cambiar({ estado: e.target.value })} className="w-full sm:w-48">
              <option value="">Activas e inactivas</option>
              <option value="activos">Solo activas</option>
              <option value="inactivos">Solo inactivas</option>
            </Selector>
            <div className="ml-auto">
              <Boton variante="primario" icono={<Plus className="size-4" aria-hidden />} onClick={() => setEditando("nueva")}>Nueva persona</Boton>
            </div>
          </>
        }
        pie={<Paginacion pagina={datos.pagina} paginas={datos.paginas} total={datos.total} nombre={datos.total === 1 ? "persona" : "personas"} onPagina={(p) => cambiar({ p: String(p) }, false)} />}
      >
        {datos.filas.length === 0 ? (
          <Vacio titulo={hayFiltro ? "Nadie coincide con el filtro" : "Todavía no hay personas"}
            accion={hayFiltro ? <Boton variante="secundario" onClick={() => cambiar({ q: "", rol: "", unidad: "", estado: "" })}>Quitar filtros</Boton> : <Boton variante="primario" onClick={() => setEditando("nueva")}>Nueva persona</Boton>}>
            {hayFiltro ? "Prueba con otro nombre, o quita el filtro de rol, unidad o estado." : "Da de alta a la primera persona; podrás asignarle unidad y superior después."}
          </Vacio>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="hidden border-b border-hilo md:table-header-group">
              <tr><Th>Persona</Th><Th>Rol</Th><Th>Unidad</Th><Th className="hidden lg:table-cell">Superior</Th><Th className="hidden xl:table-cell">Herramientas</Th><Th>Estado</Th><Th className="hidden lg:table-cell">Alta</Th><Th><span className="sr-only">Acciones</span></Th></tr>
            </thead>
            <tbody>
              {datos.filas.map((u) => (
                <tr key={u.id} className={cx(claseFila, "grid grid-cols-[1fr_auto] gap-x-3 px-4 py-2 md:table-row md:p-0")}>
                  <td className="min-w-0 md:h-11 md:px-4">
                    <button type="button" onClick={() => setEditando(u)} className="block max-w-full text-left">
                      <span className={cx("block truncate font-semibold", !u.activo && "text-texto-3 line-through decoration-texto-3/60")}>{u.nombre}{u.id === yoId && <span className="ml-1.5 font-normal text-texto-3">(tú)</span>}</span>
                      <span className="block truncate font-mono text-xs text-texto-3">{u.email}</span>
                    </button>
                  </td>
                  <td className={cx(claseCelda, "hidden md:table-cell")}>{rolNombre(u.rol)}</td>
                  <td className="col-span-2 text-texto-2 md:table-cell md:h-11 md:px-4 md:align-middle">
                    <span className="md:hidden">{rolNombre(u.rol)} · </span>{u.unidad ?? <span className="text-texto-3">Sin unidad</span>}
                  </td>
                  <td className={cx(claseCelda, "hidden text-texto-2 lg:table-cell")}>{u.manager ?? <span className="text-texto-3">—</span>}</td>
                  <td className={cx(claseCelda, "hidden xl:table-cell")}>
                    <span className="flex gap-1" aria-label={`Herramientas: ${u.herramientas.length} de ${HERRAMIENTAS.length}`}>
                      {HERRAMIENTAS.map((h) => (
                        <span key={h.clave} title={h.nombre} className={cx("rounded-sm border px-1 font-mono text-[0.6875rem]", u.herramientas.includes(h.clave as never) ? "border-hilo-fuerte text-texto" : "border-transparent text-texto-3/50 line-through")}>{h.corto}</span>
                      ))}
                    </span>
                  </td>
                  <td className="row-start-1 col-start-2 self-center md:h-11 md:px-4">
                    {!u.activo ? <CeldaEstado texto="Inactiva" tono="neutro" /> : u.expulsado ? <CeldaEstado texto="Sesión cerrada" tono="aviso" /> : <CeldaEstado texto="Activa" tono="bien" />}
                  </td>
                  <td className={cx(claseCelda, "hidden font-mono text-xs text-texto-3 lg:table-cell")}>{fFecha(u.creado)}</td>
                  <td className="hidden md:table-cell md:h-11 md:px-2 md:text-right">
                    <button type="button" onClick={() => setEditando(u)} aria-label={`Editar a ${u.nombre}`} className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida hover:text-texto">
                      <Pencil className="size-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tabla>

      <Roles roles={opciones.roles} adminUsuarios={opciones.adminUsuarios} onCambio={recargarTodo} />

      <FormularioPersona
        abierta={editando !== null}
        persona={editando === "nueva" ? null : editando}
        opciones={opciones}
        yoId={yoId}
        onCerrar={cerrar}
        onGuardada={async (msg) => { avisar(msg, { tipo: "exito" }); setEditando(null); await recargarTodo(); }}
        onExpulsar={(u) => setConfirmar({ tipo: "expulsar", u })}
        onDesactivar={(u) => setConfirmar({ tipo: "desactivar", u })}
        onActivar={activar}
      />

      <Dialogo
        abierto={!!confirmar}
        onCerrar={() => setConfirmar(null)}
        ancho="sm"
        titulo={confirmar?.tipo === "expulsar" ? "Forzar cierre de sesión" : "Desactivar cuenta"}
        pie={<>
          <Boton variante="fantasma" onClick={() => setConfirmar(null)}>Cancelar</Boton>
          <Boton variante="peligro" cargando={trabajando} onClick={accionSesion}>{confirmar?.tipo === "expulsar" ? "Cerrar su sesión" : "Desactivar"}</Boton>
        </>}
      >
        {confirmar?.tipo === "expulsar"
          ? <p><strong>{confirmar.u.nombre}</strong> saldrá de la aplicación en su próxima acción y tendrá que volver a entrar con su contraseña. Lo que estuviera escribiendo sin guardar se pierde.</p>
          : <p><strong>{confirmar?.u.nombre}</strong> no podrá entrar ni recibir trabajo nuevo. Sus tareas y su historial se conservan, y puedes reactivarla cuando quieras.</p>}
      </Dialogo>
    </div>
  );
}

async function pedirOpciones(): Promise<Opciones> {
  return pedir<Opciones>("/api/admin/roles");
}

function FormularioPersona({ abierta, persona, opciones, yoId, onCerrar, onGuardada, onExpulsar, onDesactivar, onActivar }: {
  abierta: boolean; persona: FilaUsuario | null; opciones: Opciones; yoId: number; onCerrar: () => void;
  onGuardada: (msg: string) => void; onExpulsar: (u: FilaUsuario) => void; onDesactivar: (u: FilaUsuario) => void; onActivar: (u: FilaUsuario) => void;
}) {
  const clave = persona ? `p${persona.id}` : "nueva";
  return (
    <PanelLateral
      abierto={abierta}
      onCerrar={onCerrar}
      titulo={persona ? persona.nombre : "Nueva persona"}
      subtitulo={persona ? <span className="font-mono text-xs">{persona.email}</span> : "Podrás asignarle superior y liderazgo en Organización."}
    >
      {abierta && <CamposPersona key={clave} persona={persona} opciones={opciones} yoId={yoId} onGuardada={onGuardada}
        onExpulsar={onExpulsar} onDesactivar={onDesactivar} onActivar={onActivar} />}
    </PanelLateral>
  );
}

function CamposPersona({ persona, opciones, yoId, onGuardada, onExpulsar, onDesactivar, onActivar }: {
  persona: FilaUsuario | null; opciones: Opciones; yoId: number; onGuardada: (msg: string) => void;
  onExpulsar: (u: FilaUsuario) => void; onDesactivar: (u: FilaUsuario) => void; onActivar: (u: FilaUsuario) => void;
}) {
  const [nombre, setNombre] = useState(persona?.nombre ?? "");
  const [email, setEmail] = useState(persona?.email ?? "");
  const [rol, setRol] = useState(persona?.rol ?? opciones.roles[0]?.codigo ?? "DI");
  const [unidad, setUnidad] = useState(persona?.unidadId ? String(persona.unidadId) : "");
  const [superior, setSuperior] = useState(persona?.managerId ? String(persona.managerId) : "");
  const [capacidad, setCapacidad] = useState(persona?.capacidad != null ? String(persona.capacidad) : "");
  const [herr, setHerr] = useState<string[]>(persona?.herramientas ?? HERRAMIENTAS.map((h) => h.clave));
  const [contrasena, setContrasena] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const esAdmin = rol === "admin";

  function validar() {
    const e: Record<string, string> = {};
    if (nombre.trim().length < 3) e.nombre = "Al menos 3 caracteres.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) e.email = "Escribe un correo válido.";
    if (capacidad.trim() && !(Number.isInteger(Number(capacidad)) && Number(capacidad) >= 0 && Number(capacidad) <= 80)) e.capacidad = "Un número entero de horas, de 0 a 80.";
    if (!persona && contrasena.length < 8) e.contrasena = "Al menos 8 caracteres.";
    if (persona && contrasena && contrasena.length < 8) e.contrasena = "Al menos 8 caracteres, o déjala vacía para no cambiarla.";
    setErrores(e);
    return !Object.keys(e).length;
  }

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validar()) return;
    setGuardando(true);
    const cuerpo = {
      nombre, email, rol, unidadId: unidad ? Number(unidad) : null, herramientas: herr,
      ...(persona ? { managerId: superior ? Number(superior) : null, capacidad } : {}),
      ...(contrasena ? { contrasena } : {}),
    };
    try {
      if (persona) {
        await pedir(`/api/admin/usuarios/${persona.id}`, { metodo: "PATCH", cuerpo });
        onGuardada(`${nombre} actualizada.`);
      } else {
        await pedir("/api/admin/usuarios", { cuerpo });
        onGuardada(`${nombre} dada de alta.`);
      }
    } catch (e) {
      const m = mensajeDe(e);
      setErrores(/correo/i.test(m) ? { email: m } : /contraseña/i.test(m) ? { contrasena: m } : /superior|bucle/i.test(m) ? { superior: m } : { general: m });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
      {errores.general && <p role="alert" className="rounded-sm border border-alerta/40 px-3 py-2 text-sm text-alerta">{errores.general}</p>}
      <Campo etiqueta="Nombre" error={errores.nombre}>{(a) => <Entrada {...a} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={150} autoComplete="off" />}</Campo>
      <Campo etiqueta="Correo" error={errores.email}>{(a) => <Entrada {...a} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={150} autoComplete="off" />}</Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Rol" ayuda={persona?.id === yoId ? "No puedes quitarte tu propio rol de administración." : undefined}>
          {(a) => (
            <Selector {...a} value={rol} onChange={(e) => setRol(e.target.value)} disabled={persona?.id === yoId}>
              <option value="admin">Administración</option>
              {opciones.roles.map((r) => <option key={r.id} value={r.codigo}>{r.nombre}</option>)}
              {persona && persona.rol !== "admin" && !opciones.roles.some((r) => r.codigo === persona.rol) && <option value={persona.rol}>{persona.rol}</option>}
            </Selector>
          )}
        </Campo>
        <Campo etiqueta="Unidad">
          {(a) => (
            <Selector {...a} value={unidad} onChange={(e) => setUnidad(e.target.value)}>
              <option value="">Sin unidad</option>
              {opciones.unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </Selector>
          )}
        </Campo>
      </div>
      {persona && (
        <Campo etiqueta="Reporta a" error={errores.superior} ayuda="Quien está por encima hereda las unidades que esta persona lidera.">
          {(a) => (
            <Selector {...a} value={superior} onChange={(e) => setSuperior(e.target.value)}>
              <option value="">Nadie</option>
              {opciones.personas.filter((p) => p.id !== persona.id).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </Selector>
          )}
        </Campo>
      )}
      {persona && (
        <Campo etiqueta="Capacidad semanal (horas)" error={errores.capacidad} ayuda="Vacío usa 35 h. Con 0 no recibe carga y no sale en el mapa de calor (dirección, administración).">
          {(a) => <Entrada {...a} type="number" inputMode="numeric" min="0" max="80" step="1" value={capacidad} placeholder="35" onChange={(e) => setCapacidad(e.target.value)} />}
        </Campo>
      )}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="rotulo mb-1.5">Herramientas</legend>
        {esAdmin ? <p className="text-sm text-texto-2">Administración entra a todas.</p> : HERRAMIENTAS.map((h) => (
          <label key={h.clave} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-sm px-2 hover:bg-superficie-2">
            <input type="checkbox" className="size-4 accent-[var(--texto)]" checked={herr.includes(h.clave)}
              onChange={(e) => setHerr((l) => e.target.checked ? [...l, h.clave] : l.filter((x) => x !== h.clave))} />
            {h.nombre}
          </label>
        ))}
      </fieldset>
      {persona ? (
        <details className="group rounded-sm border border-hilo" open={!!errores.contrasena}>
          <summary className="flex min-h-10 cursor-pointer items-center px-3 font-rotulo text-sm font-semibold uppercase tracking-[0.1em] text-texto-2">Cambiar contraseña</summary>
          <div className="px-3 pb-3">
            <Campo etiqueta="Contraseña nueva" error={errores.contrasena} ayuda="Déjala vacía para no cambiarla.">{(a) => <Entrada {...a} type="password" autoComplete="new-password" value={contrasena} onChange={(e) => setContrasena(e.target.value)} />}</Campo>
          </div>
        </details>
      ) : (
        <Campo etiqueta="Contraseña inicial" error={errores.contrasena} ayuda="Al menos 8 caracteres. Compártela por un canal seguro.">{(a) => <Entrada {...a} type="password" autoComplete="new-password" value={contrasena} onChange={(e) => setContrasena(e.target.value)} />}</Campo>
      )}

      <Boton type="submit" variante="primario" cargando={guardando} className="w-full">{persona ? "Guardar cambios" : "Dar de alta"}</Boton>

      {persona && persona.id !== yoId && (
        <section aria-label="Sesión y acceso" className="mt-2 border-t border-hilo pt-4">
          <h3 className="rotulo mb-2">Sesión y acceso</h3>
          <div className="flex flex-col gap-2">
            {persona.activo ? (
              <>
                <Boton variante="secundario" icono={<LogOut className="size-4" aria-hidden />} onClick={() => onExpulsar(persona)}>Forzar cierre de sesión</Boton>
                <Boton variante="peligro" icono={<Power className="size-4" aria-hidden />} onClick={() => onDesactivar(persona)}>Desactivar cuenta</Boton>
              </>
            ) : (
              <Boton variante="secundario" icono={<UserRoundCheck className="size-4" aria-hidden />} onClick={() => onActivar(persona)}>Reactivar cuenta</Boton>
            )}
          </div>
        </section>
      )}
    </form>
  );
}

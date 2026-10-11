/*
 * Los cargos de las personas: cinco, fijos. Son el cargo, no lo que se puede hacer: administrar el sistema es una
 * casilla aparte (users.is_admin), de modo que una gerente puede ser administradora sin dejar de ser gerente.
 * Los permisos reales siguen saliendo de la estructura (quien lidera una unidad, quien tiene gente a cargo), no del cargo.
 * La base lo exige (ck_users_role); esta lista es la misma.
 */
export const ROLES = [
  { codigo: "coordinador", nombre: "Coordinador" },
  { codigo: "analista", nombre: "Analista" },
  { codigo: "ejecutiva", nombre: "Ejecutiva" },
  { codigo: "gerente", nombre: "Gerente" },
  { codigo: "director", nombre: "Director" },
] as const;

export type CodigoRol = (typeof ROLES)[number]["codigo"];

export const ROL_POR_DEFECTO: CodigoRol = "analista";

export const esRol = (v: unknown): v is CodigoRol => typeof v === "string" && ROLES.some((r) => r.codigo === v);

/* El nombre para mostrar; un valor desconocido (no deberia haberlo) se muestra tal cual. */
export const nombreDeRol = (codigo: string) => ROLES.find((r) => r.codigo === codigo)?.nombre ?? codigo;

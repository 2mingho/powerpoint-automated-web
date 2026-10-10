import { NavegacionAdmin } from "./_componentes/navegacion-admin";

/*
 * Marco de administracion: estatico, sin datos. Cada pagina comprueba que
 * quien entra es admin (exigirAdmin) dentro de su <Suspense> antes de leer
 * nada; la API hace lo mismo con conUsuario(..., { soloAdmin: true }).
 */
export default function LayoutAdmin({ children }: LayoutProps<"/admin">) {
  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <NavegacionAdmin />
      {children}
    </div>
  );
}

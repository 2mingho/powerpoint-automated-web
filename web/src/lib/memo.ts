/*
 * Memoria para no repetir consultas dentro de una misma peticion (o por unos segundos).
 *
 * `cache()` de React solo deduplica mientras se renderiza una pagina: en una ruta de API
 * (un manejador) cada llamada repetia la consulta. Medido con 60.000 tareas, una sola
 * lista hacia 4 veces la misma lectura de las personas a cargo y 4 la del catalogo.
 */

/*
 * Memoria por objeto: vale mientras viva el objeto. Con el usuario de la peticion como
 * clave (nace y muere con ella), es memoria de UNA peticion: nunca sirve el alcance de
 * una persona a otra ni de una peticion a la siguiente. Una promesa fallida no se guarda.
 */
export function porObjeto<A extends object, R>(fn: (a: A) => Promise<R>): (a: A) => Promise<R> {
  const memoria = new WeakMap<A, Promise<R>>();
  return (a) => {
    let p = memoria.get(a);
    if (!p) {
      p = fn(a);
      memoria.set(a, p);
      p.catch(() => memoria.delete(a));
    }
    return p;
  };
}

/*
 * Memoria con caducidad corta y borrado explicito, para lo que casi no cambia y se lee
 * en cada peticion (los catalogos). Quien lo cambia llama a `invalidar()` y el cambio se
 * ve al instante en este proceso; en otros procesos, a lo mas tras `ms`.
 */
export function conCaducidad<R>(fn: () => Promise<R>, ms: number) {
  let guardado: { hasta: number; valor: Promise<R> } | null = null;
  return {
    leer(): Promise<R> {
      const ahora = Date.now();
      if (guardado && guardado.hasta > ahora) return guardado.valor;
      const valor = fn();
      const entrada = { hasta: ahora + ms, valor };
      guardado = entrada;
      valor.catch(() => { if (guardado === entrada) guardado = null; });
      return valor;
    },
    invalidar() { guardado = null; },
  };
}

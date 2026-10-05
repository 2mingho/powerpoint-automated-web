#!/usr/bin/env bash
# Traslada la base de Neon a Supabase: esquema, datos, secuencias y una
# comprobacion de que no se quedo nada por el camino.
#
# El esquema NO viaja en el volcado. Lo crea Alembic en el destino, igual que
# en cualquier despliegue, para que `alembic_version` quede en el mismo punto
# que el codigo y el proximo `flask db upgrade` no intente reaplicar nada. Del
# origen solo salen las filas.
#
# Uso:
#   NEON_URL='postgresql://...' SUPABASE_URL='postgresql://...' \
#       ./migrations/manual/03_migrar_neon_a_supabase.sh
#
# SUPABASE_URL tiene que ser la conexion DIRECTA (db.<ref>.supabase.co:5432),
# no el pooler de transacciones del 6543: el pooler no sostiene las sesiones
# largas ni los SET de sesion que necesitan el volcado y el reseteo.
#
# Es repetible: si algo falla a medias, se corrige y se vuelve a lanzar.
set -euo pipefail

: "${NEON_URL:?falta NEON_URL (origen)}"
: "${SUPABASE_URL:?falta SUPABASE_URL (destino, conexion directa del 5432)}"

TRABAJO="$(mktemp -d)"
VOLCADO="$TRABAJO/datos.sql"
trap 'rm -rf "$TRABAJO"' EXIT

# Las tablas cuyo contenido no debe viajar. alembic_version la escribe el
# upgrade del paso 2; copiarla ademas dejaria dos filas y Alembic se niega a
# arrancar con un historial ambiguo.
NO_VIAJAN=(alembic_version)

paso() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }


paso "1/6 Comprobando que ambos extremos responden"
psql "$NEON_URL" -Atqc 'SELECT 1' >/dev/null \
    || { echo "Neon no responde. Si es la cuota de computo, no hay nada que hacer hasta liberarla."; exit 1; }
psql "$SUPABASE_URL" -Atqc 'SELECT 1' >/dev/null \
    || { echo "Supabase no responde. Si el proyecto esta pausado, reanudalo desde el panel."; exit 1; }
echo "Origen y destino en pie."


paso "2/6 Creando el esquema en el destino con Alembic"
# Mismo mecanismo que usa el arranque del contenedor. Sobre una base vacia
# aplica las doce migraciones; sobre una ya migrada no hace nada.
DATABASE_URL="$SUPABASE_URL" FLASK_ENV=production FORCE_PRODUCTION_MODE=true \
    flask db upgrade
echo "Esquema al dia en el destino."


paso "3/6 Volcando los datos de Neon"
EXCLUIR=()
for tabla in "${NO_VIAJAN[@]}"; do
    EXCLUIR+=(--exclude-table-data="$tabla")
done

# --no-owner y --no-privileges porque los roles de Neon no existen en Supabase
# y el volcado fallaria al intentar asignarles la propiedad de cada tabla.
pg_dump "$NEON_URL" \
    --data-only \
    --no-owner \
    --no-privileges \
    --schema=public \
    "${EXCLUIR[@]}" \
    --file="$VOLCADO"
echo "Volcado en $VOLCADO ($(du -h "$VOLCADO" | cut -f1))."


paso "4/6 Cargando los datos en Supabase"
# El paso 2 no deja el destino vacio: varias migraciones siembran catalogos
# (las prioridades y los estados de tarea, entre otros) con id fijo, y el
# volcado trae esos mismos ids desde el origen. Sin vaciar antes, la carga
# muere en la primera de esas tablas por clave duplicada.
#
# Se vacia en vez de excluirlas del volcado porque esos catalogos son
# editables desde el panel: los del origen son los buenos, no los de fabrica.
# Y de paso hace el guion repetible, que es lo que promete la cabecera.
#
# session_replication_role=replica apaga las claves ajenas mientras dura todo
# esto. Hace falta por partida doble: pg_dump avisa de que users y tasks se
# referencian en circulo —ningun orden de carga las satisface— y el TRUNCATE
# en cascada tampoco pasaria con las restricciones puestas.
#
# Todo en un archivo y una transaccion: o entra entero o no entra nada.
CARGA="$TRABAJO/carga.sql"
cat > "$CARGA" <<'SQL'
SET session_replication_role = replica;

DO $$
DECLARE
    tablas text;
BEGIN
    SELECT string_agg(format('public.%I', tablename), ', ')
      INTO tablas
      FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> 'alembic_version';

    IF tablas IS NOT NULL THEN
        EXECUTE 'TRUNCATE ' || tablas || ' RESTART IDENTITY CASCADE';
    END IF;
END $$;
SQL
cat "$VOLCADO" >> "$CARGA"

psql "$SUPABASE_URL" \
    --single-transaction \
    --variable=ON_ERROR_STOP=1 \
    --quiet \
    --file="$CARGA"
echo "Datos cargados."


paso "5/6 Recolocando las secuencias"
# Las columnas serial traen su valor explicito en el volcado, asi que el
# contador de la secuencia se queda en 1 y el primer alta en la aplicacion
# chocaria con una clave existente. Se recolocan todas por descubrimiento, sin
# listarlas a mano, para que siga valiendo cuando el esquema crezca.
psql "$SUPABASE_URL" --quiet --variable=ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
    fila record;
    secuencia text;
BEGIN
    FOR fila IN
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    LOOP
        secuencia := pg_get_serial_sequence(
            format('public.%I', fila.table_name), fila.column_name
        );
        CONTINUE WHEN secuencia IS NULL;

        -- El false del tercer argumento hace que el proximo valor sea justo
        -- este; con COALESCE se cubre la tabla vacia, donde hay que volver a 1.
        EXECUTE format(
            'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM public.%I), 0) + 1, false)',
            secuencia, fila.column_name, fila.table_name
        );
        RAISE NOTICE 'secuencia recolocada: %', secuencia;
    END LOOP;
END $$;
SQL
echo "Secuencias recolocadas."


paso "6/6 Comparando el recuento de filas tabla por tabla"
# La comprobacion que de verdad importa: que el destino tenga tantas filas
# como el origen en cada tabla. Se cuenta de verdad, no por estadisticas.
contar_todas() {
    psql "$1" -Atq <<'SQL'
SELECT string_agg(
    format('SELECT %L AS tabla, count(*) AS filas FROM public.%I', tablename, tablename),
    ' UNION ALL '
    ORDER BY tablename
)
FROM pg_tables
WHERE schemaname = 'public' AND tablename <> 'alembic_version';
SQL
}

CONSULTA="$(contar_todas "$NEON_URL")"
if [ -z "$CONSULTA" ]; then
    echo "El origen no tiene tablas que comparar."; exit 1
fi

psql "$NEON_URL"     -Atq -c "$CONSULTA" | sort > "$TRABAJO/origen.txt"
psql "$SUPABASE_URL" -Atq -c "$CONSULTA" | sort > "$TRABAJO/destino.txt"

if diff -u "$TRABAJO/origen.txt" "$TRABAJO/destino.txt" > "$TRABAJO/diferencias.txt"; then
    echo "Coinciden todas las tablas:"
    sed 's/^/  /' "$TRABAJO/destino.txt"
    printf '\n\033[1mMigracion terminada.\033[0m Queda apuntar DATABASE_URL en Coolify al destino.\n'
else
    echo "NO COINCIDEN. Izquierda es Neon, derecha es Supabase:"
    cat "$TRABAJO/diferencias.txt"
    exit 1
fi

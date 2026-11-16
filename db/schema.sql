CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS socavones (
    id SERIAL PRIMARY KEY,
    fecha_incidente DATE NOT NULL,
    municipio VARCHAR(80) NOT NULL,
    colonia VARCHAR(120),
    calle_principal VARCHAR(150),
    cruces VARCHAR(150),
    latitud DOUBLE PRECISION NOT NULL,
    longitud DOUBLE PRECISION NOT NULL,
    ubicacion GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint(longitud, latitud), 4326)::geography
    ) STORED,
    causa_aparente VARCHAR(60) NOT NULL,
    tamano_categoria VARCHAR(30),
    estado VARCHAR(30) NOT NULL DEFAULT 'Reportado / Activo',
    fuente VARCHAR(50) NOT NULL DEFAULT 'Reporte ciudadano',
    reportes_sumados INTEGER NOT NULL DEFAULT 1,
    verificado BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_socavones_ubicacion ON socavones USING GIST (ubicacion);
CREATE INDEX IF NOT EXISTS idx_socavones_fecha ON socavones (fecha_incidente);
CREATE INDEX IF NOT EXISTS idx_socavones_municipio ON socavones (municipio);


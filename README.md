# Plataforma Web de Registro de Socavones (ZMG)

Plataforma ciudadana georreferenciada para el registro de socavones y hundimientos en la Zona Metropolitana de Guadalajara (ZMG).

## Estructura del proyecto

- `frontend/` — SPA con Node.js (Vite + React + Tailwind CSS + shadcn/ui + Sileo + Leaflet 1.9.4), lista para **Cloudflare Pages**.
- `db/schema.sql` — Esquema PostgreSQL + PostGIS con columna `ubicacion GEOGRAPHY(Point, 4326)` generada e índices GIST/B-tree.
- `worker/src/index.js` — API en Cloudflare Workers (ES Modules, `nodejs_compat`, `pg` + Hyperdrive).
- `terraform/` — Infraestructura como código con `cloudflare/cloudflare ~> 5.0` (Hyperdrive, Turnstile, Workers Script, Subdomain y Route opcional).

## Base de datos

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

## Desarrollo local (Node.js + Wrangler)

1. **Backend (Worker API en `http://localhost:8787`)**:
```bash
cd worker
npm install
# Configura DATABASE_URL en worker/.dev.vars
npm run dev
```

2. **Frontend (Vite en `http://localhost:5173`, con proxy `/api` al Worker)**:
```bash
cd frontend
npm install
npm run dev
```

## Despliegue en Cloudflare Pages (`frontend/`)

- **Root directory**: `frontend`
- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **Variable de entorno (si el Worker está en otro dominio/subdominio)**: `VITE_API_BASE_URL=https://socavones-zmg-api.<tu-subdominio>.workers.dev`

## Despliegue de infraestructura con Terraform (`cloudflare/cloudflare ~> 5.0`)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform validate
terraform plan
terraform apply
```

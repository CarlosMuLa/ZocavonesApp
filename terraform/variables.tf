variable "cloudflare_api_token" {
  description = "Cloudflare API token con permisos para Workers, Hyperdrive, Turnstile y Routes"
  type        = string
  sensitive   = true
}

variable "account_id" {
  description = "ID de la cuenta de Cloudflare"
  type        = string
}

variable "environment" {
  description = "Nombre del entorno (ej. production, staging)"
  type        = string
  default     = "production"
}

variable "worker_script_name" {
  description = "Nombre del Cloudflare Worker"
  type        = string
  default     = "socavones-zmg-api"
}

variable "worker_bundle_path" {
  description = "Ruta al bundle o módulo principal del Worker"
  type        = string
  default     = "../worker/src/index.js"
}

variable "db_host" {
  description = "Hostname del servidor PostgreSQL + PostGIS"
  type        = string
}

variable "db_port" {
  description = "Puerto de PostgreSQL"
  type        = number
  default     = 5432
}

variable "db_name" {
  description = "Nombre de la base de datos PostgreSQL"
  type        = string
}

variable "db_user" {
  description = "Usuario de PostgreSQL"
  type        = string
}

variable "db_password" {
  description = "Contraseña de PostgreSQL"
  type        = string
  sensitive   = true
}

variable "turnstile_domains" {
  description = "Lista de dominios permitidos para Turnstile (ordenados alfabéticamente)"
  type        = list(string)
}

variable "admin_seed_token" {
  description = "Token Bearer para proteger POST /api/admin/seed"
  type        = string
  sensitive   = true
}

variable "zone_id" {
  description = "Zone ID de Cloudflare (opcional, requerido solo si se define custom_route_pattern)"
  type        = string
  default     = ""
}

variable "custom_route_pattern" {
  description = "Patrón de ruta personalizada para el Worker (ej. socavones.tudominio.mx/*)"
  type        = string
  default     = ""
}


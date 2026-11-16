output "hyperdrive_config_id" {
  description = "ID de la configuración de Cloudflare Hyperdrive"
  value       = cloudflare_hyperdrive_config.postgres.id
}

output "turnstile_sitekey" {
  description = "Sitekey pública del widget Turnstile"
  value       = cloudflare_turnstile_widget.app.sitekey
}

output "worker_script_name" {
  description = "Nombre del Worker desplegado"
  value       = cloudflare_workers_script.api.script_name
}


resource "cloudflare_hyperdrive_config" "postgres" {
  account_id = var.account_id
  name       = "${var.worker_script_name}-${var.environment}-pg"

  origin = {
    scheme   = "postgres"
    host     = var.db_host
    port     = var.db_port
    database = var.db_name
    user     = var.db_user
    password = var.db_password
  }

  caching = {
    disabled  = false
    max_age   = 60
    stale_age = 300
  }
}

resource "cloudflare_turnstile_widget" "app" {
  account_id = var.account_id
  name       = "${var.worker_script_name}-${var.environment}-turnstile"
  domains    = sort(var.turnstile_domains)
  mode       = "managed"
  region     = "world"
}

resource "cloudflare_workers_script" "api" {
  account_id          = var.account_id
  script_name         = var.worker_script_name
  main_module         = "index.js"
  content             = file("${path.module}/${var.worker_bundle_path}")
  compatibility_date  = "2024-11-01"
  compatibility_flags = ["nodejs_compat"]

  bindings = [
    {
      type = "hyperdrive"
      name = "HYPERDRIVE"
      id   = cloudflare_hyperdrive_config.postgres.id
    },
    {
      type = "plain_text"
      name = "ENVIRONMENT"
      text = var.environment
    },
    {
      type = "plain_text"
      name = "TURNSTILE_SITEKEY"
      text = cloudflare_turnstile_widget.app.sitekey
    },
    {
      type = "secret_text"
      name = "TURNSTILE_SECRET"
      text = cloudflare_turnstile_widget.app.secret
    },
    {
      type = "secret_text"
      name = "ADMIN_SEED_TOKEN"
      text = var.admin_seed_token
    }
  ]
}

resource "cloudflare_workers_script_subdomain" "api_subdomain" {
  account_id       = var.account_id
  script_name      = cloudflare_workers_script.api.script_name
  enabled          = true
  previews_enabled = false
}

resource "cloudflare_workers_route" "custom_route" {
  count   = var.zone_id != "" && var.custom_route_pattern != "" ? 1 : 0
  zone_id = var.zone_id
  pattern = var.custom_route_pattern
  script  = cloudflare_workers_script.api.script_name
}


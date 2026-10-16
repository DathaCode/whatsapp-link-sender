# Services and FinOps

## Service Selection Priority (Cheapest First)
```
1. Open-source self-hosted on OCI free tier (cost: $0)
2. Cloud provider free tier services
3. Open-source self-hosted on spot instances
4. Managed services with pay-per-use pricing
5. Managed services with reserved pricing
6. SaaS with free tier
7. SaaS with paid tier (last resort for solo dev)
```

## Monitoring Stack — Cost-Optimized Choices
| Need | Expensive Option | Cost-Optimized Option |
|------|-----------------|----------------------|
| Metrics | Datadog ($15/host/mo) | Self-hosted Grafana + Prometheus (free on OCI) |
| Logs | Splunk/Datadog Logs | Self-hosted ELK/OpenSearch (free on OCI) or CloudWatch Logs basic |
| APM | New Relic/Datadog APM | OpenTelemetry → Grafana Tempo (free self-hosted) |
| Alerts | PagerDuty ($21/user) | Grafana Alerting → email/Slack webhook (free) |
| Uptime | StatusCake Pro | UptimeRobot free (50 monitors) or self-hosted |

## Database — Cost-Optimized Choices
| Need | Expensive Option | Cost-Optimized Option |
|------|-----------------|----------------------|
| Relational DB | AWS RDS Multi-AZ | OCI Autonomous DB (always free) for dev, single-AZ RDS for small prod |
| Cache | ElastiCache | Self-hosted Redis on OCI free tier |
| Search | Elasticsearch Service | Self-hosted OpenSearch on OCI ARM instances |
| Queue | Amazon MQ | SQS (1M free) or self-hosted RabbitMQ |

## CI/CD — Cost-Optimized
```
GitHub Actions Free Tier:
- Public repos: unlimited minutes
- Private repos: 2,000 minutes/month free

Cost Optimization:
- Use self-hosted runners on OCI free tier for heavy builds
- Cache dependencies aggressively (saves minutes = saves money)
- Use matrix builds only when truly needed
- Skip CI on docs-only changes
```

## Billing Alerts (Set Up IMMEDIATELY)
```hcl
# AWS — alert at multiple thresholds
resource "aws_budgets_budget" "monthly" {
  name         = "monthly-budget"
  budget_type  = "COST"
  limit_amount = "50"           # Set YOUR monthly limit
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 50     # Alert at 50% of budget
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 80     # Alert at 80%
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 100    # Alert when exceeded
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}
```

## Cost Tagging Strategy
```hcl
# Tag EVERY resource for cost tracking
locals {
  common_tags = {
    Project     = var.app_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Owner       = "solo-dev"
    CostCenter  = var.app_name
  }
}

# Use in every resource:
resource "aws_instance" "app" {
  tags = merge(local.common_tags, {
    Name = "${var.app_name}-${var.environment}"
  })
}
```

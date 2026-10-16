# Cloud and Infrastructure Cost Optimization

## AWS Free Tier Essentials (Use These First)
```
- EC2: 750 hrs/month t2.micro or t3.micro (12 months)
- RDS: 750 hrs/month db.t3.micro (12 months)
- S3: 5 GB storage (12 months)
- Lambda: 1M requests/month (always free)
- DynamoDB: 25 GB storage + 25 read/write units (always free)
- CloudWatch: 10 custom metrics, 10 alarms (always free)
- ECR: 500 MB storage (always free)
- SNS: 1M publishes (always free)
- SQS: 1M requests (always free)
- API Gateway: 1M REST API calls/month (12 months)
```

## OCI Always Free Tier (Leverage Heavily)
```
- Compute: 2 AMD VMs (1/8 OCPU, 1 GB RAM each) — ALWAYS FREE
- Compute: 4 ARM Ampere A1 cores + 24 GB RAM total — ALWAYS FREE
- Block Storage: 200 GB total — ALWAYS FREE
- Object Storage: 10 GB — ALWAYS FREE
- Load Balancer: 1 flexible LB (10 Mbps) — ALWAYS FREE
- Database: 2 Autonomous DBs (20 GB each) — ALWAYS FREE
- Monitoring: 500M ingestion data points — ALWAYS FREE
- Logging: 10 GB/month — ALWAYS FREE
- Vault: 20 key versions — ALWAYS FREE
```

**Strategy**: Use OCI Always Free for dev/staging, AWS for production where needed.

## Compute Cost Optimization

### Right-Sizing Pattern
```hcl
# Start with the SMALLEST instance, monitor, then resize
# DEV
variable "instance_type" {
  default = {
    dev     = "t3.micro"      # $0.0104/hr — cheapest
    staging = "t3.small"      # $0.0208/hr
    prod    = "t3.medium"     # $0.0416/hr — upgrade only if needed
  }
}

# Auto-scaling: scale DOWN aggressively
resource "aws_autoscaling_group" "app" {
  min_size         = var.environment == "prod" ? 2 : 1
  max_size         = var.environment == "prod" ? 6 : 2
  desired_capacity = var.environment == "prod" ? 2 : 1

  # Scale down quickly, scale up carefully
  # Configure scale-in with longer cooldown
}
```

### Spot Instances for Non-Prod
```hcl
# 60-90% savings over on-demand
resource "aws_launch_template" "spot" {
  instance_market_options {
    market_type = "spot"
    spot_options {
      max_price          = "0.02"  # Set a max you're willing to pay
      spot_instance_type = "one-time"
    }
  }
}
```

### Schedule Dev/Staging Shutdown
```hcl
# Auto-stop dev instances at 7 PM, start at 8 AM (saves ~60%)
resource "aws_autoscaling_schedule" "night_stop" {
  scheduled_action_name  = "night-stop"
  autoscaling_group_name = aws_autoscaling_group.dev.name
  recurrence             = "0 19 * * MON-FRI"  # 7 PM weekdays
  min_size               = 0
  max_size               = 0
  desired_capacity       = 0
}

resource "aws_autoscaling_schedule" "morning_start" {
  scheduled_action_name  = "morning-start"
  autoscaling_group_name = aws_autoscaling_group.dev.name
  recurrence             = "0 8 * * MON-FRI"   # 8 AM weekdays
  min_size               = 1
  max_size               = 2
  desired_capacity       = 1
}
```

## Database Cost Optimization

### Use Serverless Where Possible
```hcl
# Aurora Serverless v2 — scales to zero-ish (0.5 ACU minimum)
resource "aws_rds_cluster" "main" {
  engine         = "aurora-postgresql"
  engine_mode    = "provisioned"
  serverlessv2_scaling_configuration {
    min_capacity = 0.5    # Minimum (cheapest)
    max_capacity = 4      # Only scales when needed
  }
}

# OCI Autonomous DB — free tier has 2 databases!
resource "oci_database_autonomous_database" "main" {
  is_free_tier            = var.environment == "dev" ? true : false
  compute_count           = var.environment == "dev" ? 1 : 2
  data_storage_size_in_gb = var.environment == "dev" ? 20 : 50
  is_auto_scaling_enabled = true
}
```

## Storage Cost Optimization

### S3 Lifecycle Rules (Automatic Cost Reduction)
```hcl
resource "aws_s3_bucket_lifecycle_configuration" "cost_optimize" {
  bucket = aws_s3_bucket.data.id

  rule {
    id     = "archive-old-data"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "STANDARD_IA"        # 45% cheaper
    }
    transition {
      days          = 90
      storage_class = "GLACIER_INSTANT_RETRIEVAL"  # 68% cheaper
    }
    transition {
      days          = 365
      storage_class = "DEEP_ARCHIVE"       # 95% cheaper
    }

    # Delete old versions
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
```

## Kubernetes Cost Optimization

### Use Karpenter/Cluster Autoscaler
```yaml
# Scale nodes to zero when no pods need them
# Karpenter provisioner — cost-optimized
apiVersion: karpenter.sh/v1alpha5
kind: Provisioner
metadata:
  name: default
spec:
  requirements:
    - key: karpenter.sh/capacity-type
      operator: In
      values: ["spot", "on-demand"]     # Prefer spot
    - key: node.kubernetes.io/instance-type
      operator: In
      values: ["t3.medium", "t3.large"]  # Limit to cost-effective types
  limits:
    resources:
      cpu: "20"                          # Cap total cluster CPU
      memory: "40Gi"
  ttlSecondsAfterEmpty: 30               # Remove empty nodes fast
```

## Monthly Cost Audit Checklist
```
□ Check for unused EBS volumes (aws ec2 describe-volumes --filters Name=status,Values=available)
□ Check for unused Elastic IPs ($3.65/month each if unattached)
□ Check for idle load balancers
□ Check for over-provisioned RDS instances
□ Review S3 bucket sizes and lifecycle rules
□ Check for unused NAT gateways ($32/month + data processing)
□ Review CloudWatch log retention (set expiry, don't keep forever)
□ Check ECR image count (old images waste storage)
□ Review data transfer costs (often the hidden killer)
□ Compare on-demand spend vs reserved/savings plan potential
```

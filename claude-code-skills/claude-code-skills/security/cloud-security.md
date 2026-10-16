# Cloud Security (AWS + Oracle Cloud)

## IAM — Least Privilege Always

### AWS IAM Patterns
```hcl
# NEVER use inline policies or wildcard actions in production
# BAD:
# Action = ["*"]
# Resource = ["*"]

# GOOD — specific actions and resources
resource "aws_iam_policy" "app_s3_access" {
  name = "${var.app_name}-s3-read"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::${var.bucket_name}",
          "arn:aws:s3:::${var.bucket_name}/*"
        ]
      }
    ]
  })
}

# Use IAM roles for services — NEVER long-lived access keys
resource "aws_iam_role" "app_role" {
  name = "${var.app_name}-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}
```

### OCI IAM Patterns
```hcl
# Use compartments for resource isolation
resource "oci_identity_compartment" "app_compartment" {
  compartment_id = var.tenancy_ocid
  description    = "Compartment for ${var.app_name}"
  name           = "${var.app_name}-${var.environment}"
}

# Use dynamic groups + policies instead of user credentials
resource "oci_identity_dynamic_group" "app_instances" {
  compartment_id = var.tenancy_ocid
  name           = "${var.app_name}-instances"
  description    = "Instances running ${var.app_name}"
  matching_rule  = "ALL {instance.compartment.id = '${oci_identity_compartment.app_compartment.id}'}"
}

resource "oci_identity_policy" "app_policy" {
  compartment_id = var.tenancy_ocid
  name           = "${var.app_name}-policy"
  description    = "Policy for ${var.app_name}"
  statements = [
    "Allow dynamic-group ${oci_identity_dynamic_group.app_instances.name} to read secret-family in compartment ${var.app_name}-${var.environment}",
    "Allow dynamic-group ${oci_identity_dynamic_group.app_instances.name} to use log-content in compartment ${var.app_name}-${var.environment}",
  ]
}
```

## Network Security

### AWS VPC Security
```hcl
# Private subnets for all workloads — public subnets only for ALB/NLB
resource "aws_security_group" "app" {
  name_prefix = "${var.app_name}-app-"
  vpc_id      = var.vpc_id

  # Only allow traffic from ALB
  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # Restrict egress to what's needed
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]  # HTTPS out (for API calls)
  }

  egress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.db.id]  # DB only
  }

  tags = { Name = "${var.app_name}-app-sg" }
}
```

### OCI Network Security
```hcl
resource "oci_core_security_list" "app" {
  compartment_id = var.compartment_id
  vcn_id         = var.vcn_id
  display_name   = "${var.app_name}-app-sl"

  ingress_security_rules {
    protocol  = "6"  # TCP
    source    = var.lb_subnet_cidr
    tcp_options {
      min = 8000
      max = 8000
    }
  }

  egress_security_rules {
    protocol    = "6"
    destination = "0.0.0.0/0"
    tcp_options {
      min = 443
      max = 443
    }
  }
}
```

## Encryption

### S3 Bucket Encryption (Always Enable)
```hcl
resource "aws_s3_bucket" "data" {
  bucket = "${var.app_name}-data-${var.environment}"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration {
    status = "Enabled"
  }
}
```

### Database Encryption
```hcl
# AWS RDS — always encrypt
resource "aws_db_instance" "main" {
  storage_encrypted   = true
  kms_key_id          = var.kms_key_arn  # Use customer-managed key
  deletion_protection = true              # Prevent accidental deletion
  # ...
}

# OCI — always encrypt
resource "oci_database_autonomous_database" "main" {
  is_auto_scaling_enabled = true
  # OCI encrypts by default with Oracle-managed keys
  # For customer-managed: use kms_key_id
}
```

## Logging and Audit

### AWS CloudTrail (Always Enable)
```hcl
resource "aws_cloudtrail" "main" {
  name                       = "${var.app_name}-trail"
  s3_bucket_name             = aws_s3_bucket.cloudtrail.id
  is_multi_region_trail      = true
  enable_log_file_validation = true
  cloud_watch_logs_group_arn = "${aws_cloudwatch_log_group.cloudtrail.arn}:*"
  cloud_watch_logs_role_arn  = aws_iam_role.cloudtrail_cloudwatch.arn
}
```

## Security Audit Checklist
```
□ All S3 buckets have public access blocked
□ All databases encrypted at rest
□ All traffic uses TLS/HTTPS
□ VPC flow logs enabled
□ CloudTrail enabled in all regions
□ No IAM users with console access (use SSO)
□ No long-lived access keys
□ Security groups follow least privilege
□ WAF enabled on public-facing ALBs
□ GuardDuty enabled (AWS) / Cloud Guard enabled (OCI)
```

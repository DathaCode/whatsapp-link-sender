# Auth and Secrets Management

## Secrets — The Golden Rules
1. **NEVER** put secrets in code, Dockerfiles, docker-compose files, or Terraform files
2. **NEVER** commit `.env` files to Git (always in `.gitignore`)
3. **NEVER** log secrets — mask them in all log output
4. **NEVER** pass secrets as build args in Docker (they persist in image layers)

## Where to Store Secrets (By Context)

### Local Development
```bash
# Use .env files (NEVER committed to git)
# .env
DB_PASSWORD=local_dev_password
API_KEY=dev_key_here

# .gitignore MUST contain:
.env
.env.*
!.env.example
```

Always create a `.env.example` with placeholder values:
```bash
# .env.example (this IS committed to git)
DB_PASSWORD=your_db_password_here
API_KEY=your_api_key_here
```

### AWS Secrets
```hcl
# Use AWS Secrets Manager or SSM Parameter Store
resource "aws_secretsmanager_secret" "app_secret" {
  name                    = "${var.app_name}-${var.environment}-secrets"
  recovery_window_in_days = 7
}

# Reference in EKS via External Secrets Operator or direct SDK call
# NEVER use aws_secretsmanager_secret_version in Terraform outputs
```

### Oracle Cloud (OCI) Secrets
```hcl
# Use OCI Vault
resource "oci_kms_vault" "app_vault" {
  compartment_id = var.compartment_id
  display_name   = "${var.app_name}-vault"
  vault_type     = "DEFAULT"
}

resource "oci_vault_secret" "app_secret" {
  compartment_id = var.compartment_id
  vault_id       = oci_kms_vault.app_vault.id
  key_id         = oci_kms_key.master_key.id
  secret_name    = "${var.app_name}-db-password"
  secret_content {
    content_type = "BASE64"
    content      = base64encode(var.db_password)
  }
}
```

### Kubernetes Secrets
```yaml
# NEVER put plain secrets in manifests committed to git
# Use External Secrets Operator or Sealed Secrets

# external-secret.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: app-secrets
  namespace: myapp-prod
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: app-secrets
    creationPolicy: Owner
  data:
    - secretKey: DB_PASSWORD
      remoteRef:
        key: myapp-prod-secrets
        property: db_password
```

### GitHub Actions Secrets
```yaml
# Store in GitHub Settings → Secrets and Variables → Actions
# Reference as:
env:
  DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

# For OIDC (preferred over long-lived keys):
permissions:
  id-token: write
  contents: read
steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::ACCOUNT_ID:role/github-actions-role
      aws-region: us-east-1
```

## Authentication Patterns

### API Authentication (Python/FastAPI)
```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt

security = HTTPBearer()

async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.JWT_SECRET,
            algorithms=["HS256"]
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
```

### API Key Rotation Pattern
```python
# Support both old and new keys during rotation window
VALID_API_KEYS = {
    os.getenv("API_KEY_CURRENT"),
    os.getenv("API_KEY_PREVIOUS"),  # Keep previous key valid for 24h after rotation
}
VALID_API_KEYS.discard(None)

async def verify_api_key(api_key: str = Header(alias="X-API-Key")):
    if api_key not in VALID_API_KEYS:
        raise HTTPException(status_code=403, detail="Invalid API key")
```

## Password Handling
```python
# ALWAYS use bcrypt or argon2 — NEVER MD5, SHA1, or plain SHA256
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)
```

## Secret Rotation Checklist
```
□ Can secrets be rotated without downtime? (support current + previous)
□ Is there an automated rotation schedule?
□ Are old secrets revoked after rotation window?
□ Is rotation logged and auditable?
□ Are dependent services updated automatically?
```

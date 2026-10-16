# Web Security

## HTTP Security Headers (Apply to ALL Web Apps)

### Nginx/Reverse Proxy Config
```nginx
# Add to every server block
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.yourdomain.com;" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

### FastAPI Security Headers Middleware
```python
from starlette.middleware.base import BaseHTTPMiddleware

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

app.add_middleware(SecurityHeadersMiddleware)
```

## CORS Configuration

### FastAPI CORS (Be Specific — Never Use "*" in Prod)
```python
from fastapi.middleware.cors import CORSMiddleware

# DEVELOPMENT
if settings.ENVIRONMENT == "dev":
    origins = ["http://localhost:3000", "http://localhost:5173"]
else:
    # PRODUCTION — explicit origins only
    origins = ["https://app.yourdomain.com", "https://yourdomain.com"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,         # NEVER ["*"] in production
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key"],
    max_age=600,
)
```

## Input Validation

### Python/FastAPI — Use Pydantic Models
```python
from pydantic import BaseModel, Field, validator
import re

class UserCreate(BaseModel):
    email: str = Field(..., max_length=255)
    name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=8, max_length=128)

    @validator("email")
    def validate_email(cls, v):
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(pattern, v):
            raise ValueError("Invalid email format")
        return v.lower().strip()

    @validator("name")
    def sanitize_name(cls, v):
        # Strip HTML tags
        clean = re.sub(r'<[^>]+>', '', v)
        return clean.strip()
```

### React — Never Trust Client-Side Only Validation
```typescript
// Client-side validation is for UX only — ALWAYS validate server-side too
const sanitizeInput = (input: string): string => {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};
```

## SQL Injection Prevention
```python
# ALWAYS use parameterized queries — NEVER string concatenation
# BAD (vulnerable):
# cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")

# GOOD (parameterized):
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))

# With SQLAlchemy ORM (inherently safe):
user = session.query(User).filter(User.id == user_id).first()
```

## Rate Limiting

### FastAPI Rate Limiting
```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.post("/api/login")
@limiter.limit("5/minute")      # Strict for auth endpoints
async def login(request: Request):
    pass

@app.get("/api/data")
@limiter.limit("60/minute")     # Moderate for data endpoints
async def get_data(request: Request):
    pass
```

### Nginx Rate Limiting
```nginx
# Define rate limit zones
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

location /api/ {
    limit_req zone=api burst=10 nodelay;
}

location /api/auth/ {
    limit_req zone=login burst=3 nodelay;
}
```

## XSS Prevention in React
```typescript
// React auto-escapes JSX by default — but watch out for:

// DANGEROUS — never use unless absolutely necessary:
// <div dangerouslySetInnerHTML={{ __html: userContent }} />

// If you MUST render HTML, sanitize first:
import DOMPurify from 'dompurify';
const safeHTML = DOMPurify.sanitize(userContent);
// <div dangerouslySetInnerHTML={{ __html: safeHTML }} />

// SAFE — React auto-escapes this:
<div>{userContent}</div>
```

## CSRF Protection
```python
# For cookie-based auth, use CSRF tokens
from fastapi_csrf_protect import CsrfProtect

@CsrfProtect.load_config
def get_csrf_config():
    return {
        "secret_key": settings.CSRF_SECRET,
        "cookie_samesite": "strict",
        "cookie_secure": True,  # HTTPS only
    }
```

## File Upload Security
```python
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf", ".csv"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

async def validate_upload(file: UploadFile):
    # Check extension
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"File type {ext} not allowed")

    # Check actual file size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large (max 10MB)")

    # Check magic bytes (don't trust extension alone)
    import magic
    mime = magic.from_buffer(content, mime=True)
    allowed_mimes = {"image/jpeg", "image/png", "application/pdf", "text/csv"}
    if mime not in allowed_mimes:
        raise HTTPException(400, "Invalid file content type")

    await file.seek(0)  # Reset for further processing
    return content
```

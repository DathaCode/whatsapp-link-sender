# Code-Level Savings

## API & Compute Cost Reduction

### Caching (Reduces Compute + DB Load)
```python
# Redis caching pattern
from functools import wraps
import json, hashlib, redis

redis_client = redis.Redis(host=settings.REDIS_HOST, port=6379, decode_responses=True)

def cache(ttl_seconds=300):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            key = f"{func.__name__}:{hashlib.md5(json.dumps([args, kwargs], default=str).encode()).hexdigest()}"
            cached = redis_client.get(key)
            if cached:
                return json.loads(cached)
            result = await func(*args, **kwargs)
            redis_client.setex(key, ttl_seconds, json.dumps(result, default=str))
            return result
        return wrapper
    return decorator

@cache(ttl_seconds=600)
async def get_expensive_data(user_id: int):
    # Database query that runs once, then cache for 10 min
    return await db.fetch_user_analytics(user_id)
```

### Response Compression (Reduces Bandwidth Costs)
```python
# FastAPI — enable gzip
from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=500)
```

```nginx
# Nginx — enable gzip
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
```

### Pagination (Reduces Data Transfer)
```python
# NEVER return unbounded results
@app.get("/api/items")
async def list_items(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),  # Max 100 items per request
):
    offset = (page - 1) * per_page
    items = await db.fetch_items(limit=per_page, offset=offset)
    total = await db.count_items()
    return {
        "data": items,
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": ceil(total / per_page),
        }
    }
```

### Database Query Optimization
```python
# BAD — N+1 query problem (100 users = 101 queries)
users = session.query(User).all()
for user in users:
    print(user.orders)  # Each access = 1 query

# GOOD — eager loading (1 query)
users = session.query(User).options(selectinload(User.orders)).all()

# GOOD — select only needed columns
users = session.query(User.id, User.name).all()  # Don't SELECT *

# Add indexes for frequently queried columns
# In SQLAlchemy:
class User(Base):
    email = Column(String, index=True)  # Add index
    created_at = Column(DateTime, index=True)
```

## Frontend Cost Reduction

### Image Optimization (Reduces CDN/Bandwidth Costs)
```typescript
// Use next/image or manual optimization
// Serve WebP/AVIF format, lazy load, responsive sizes
<img
  src={imageUrl}
  loading="lazy"                          // Don't load offscreen images
  srcSet={`${imageUrl}?w=400 400w, ${imageUrl}?w=800 800w`}
  sizes="(max-width: 600px) 400px, 800px"
/>

// Compress images at upload time (Python backend)
from PIL import Image
def optimize_image(input_path, output_path, max_width=1200, quality=80):
    img = Image.open(input_path)
    img.thumbnail((max_width, max_width))
    img.save(output_path, optimize=True, quality=quality)
```

### Bundle Size Optimization
```typescript
// Use dynamic imports for code splitting
const HeavyComponent = React.lazy(() => import('./HeavyComponent'));

// Tree-shake imports — import only what you need
// BAD:
import _ from 'lodash';
// GOOD:
import debounce from 'lodash/debounce';
```

## Docker Image Size (Smaller = Faster Pulls = Less Storage Cost)
```dockerfile
# Use slim/alpine bases
FROM python:3.12-slim          # ~150MB vs ~1GB for full
FROM node:20-alpine            # ~180MB vs ~1GB for full

# Install only production dependencies
RUN pip install --no-cache-dir -r requirements.txt
RUN npm ci --only=production

# Clean up in the same layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y build-essential \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
```

## Lambda/Serverless Optimization
```python
# Keep cold starts fast:
# 1. Minimize package size
# 2. Initialize outside handler (reused across invocations)
# 3. Use provisioned concurrency only if needed

import boto3

# Initialize OUTSIDE handler — reused across warm invocations
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('my-table')

def handler(event, context):
    # This runs every invocation
    return table.get_item(Key={'id': event['id']})
```

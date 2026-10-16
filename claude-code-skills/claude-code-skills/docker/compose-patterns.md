# Docker Compose Patterns

## Development Environment (Full Stack)
```yaml
# docker-compose.yml (development)
version: "3.9"

services:
  # === BACKEND ===
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: development            # Use dev stage if multi-stage
    ports:
      - "8000:8000"
    volumes:
      - ./backend:/app/backend       # Hot reload
      - /app/__pycache__             # Exclude pycache from mount
    environment:
      - ENVIRONMENT=dev
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/myapp
      - REDIS_URL=redis://redis:6379/0
    env_file:
      - .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
    networks:
      - backend-net

  # === FRONTEND ===
  frontend:
    build:
      context: ./frontend
      target: development
    ports:
      - "3000:3000"
    volumes:
      - ./frontend/src:/app/src      # Hot reload
    environment:
      - VITE_API_URL=http://localhost:8000
    command: npm run dev -- --host 0.0.0.0
    networks:
      - backend-net

  # === DATABASE ===
  db:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres     # Dev only — never in production
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - backend-net

  # === CACHE ===
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - backend-net

volumes:
  postgres_data:
  redis_data:

networks:
  backend-net:
    driver: bridge
```

## Production Compose Override
```yaml
# docker-compose.prod.yml (use with: docker compose -f docker-compose.yml -f docker-compose.prod.yml up)
version: "3.9"

services:
  api:
    build:
      target: production
    restart: always
    volumes: []                        # No source mounts in prod
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 128M
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  frontend:
    build:
      target: production
    restart: always
    volumes: []
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M

  db:
    restart: always
    ports: []                          # Don't expose DB port externally in prod
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}  # From env, not hardcoded

  redis:
    restart: always
    ports: []
    command: redis-server --requirepass ${REDIS_PASSWORD}
```

## Monitoring Stack Compose (Grafana + Prometheus + ELK)
```yaml
# docker-compose.monitoring.yml
version: "3.9"

services:
  prometheus:
    image: prom/prometheus:v2.53.0
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=30d'
    restart: always
    networks:
      - monitoring-net

  grafana:
    image: grafana/grafana:11.1.0
    ports:
      - "3001:3000"
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana/provisioning:/etc/grafana/provisioning
      - ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards
    environment:
      GF_SECURITY_ADMIN_USER: ${GRAFANA_USER:-admin}
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
      GF_INSTALL_PLUGINS: grafana-clock-panel
    depends_on:
      - prometheus
    restart: always
    networks:
      - monitoring-net

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.14.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false   # Enable in prod with proper config
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data
    ports:
      - "9200:9200"
    restart: always
    networks:
      - monitoring-net

  kibana:
    image: docker.elastic.co/kibana/kibana:8.14.0
    ports:
      - "5601:5601"
    environment:
      ELASTICSEARCH_HOSTS: http://elasticsearch:9200
    depends_on:
      - elasticsearch
    restart: always
    networks:
      - monitoring-net

  node-exporter:
    image: prom/node-exporter:v1.8.1
    ports:
      - "9100:9100"
    restart: always
    networks:
      - monitoring-net

volumes:
  prometheus_data:
  grafana_data:
  elasticsearch_data:

networks:
  monitoring-net:
    driver: bridge
```

## Useful Compose Commands
```bash
# Development
docker compose up -d                       # Start all services
docker compose up -d --build               # Rebuild and start
docker compose logs -f api                 # Follow logs for one service
docker compose exec api bash               # Shell into running container
docker compose down                        # Stop all
docker compose down -v                     # Stop and remove volumes (reset DB)

# Production
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Scaling (simple)
docker compose up -d --scale api=3
```

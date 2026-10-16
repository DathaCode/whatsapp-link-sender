# Pattern Recognition — Common Error Patterns and Fixes

## Docker Errors

### Pattern: "COPY failed: file not found"
- **Root Cause**: File path is relative to build context, not the Dockerfile location
- **Fix**: Check `.dockerignore` isn't excluding the file. Verify path from build context root.
- **Prevention**: Always run `docker build` from the project root with `-f` flag for nested Dockerfiles

### Pattern: "permission denied" in container
- **Root Cause**: File owned by root but container runs as non-root user
- **Fix**: Add `COPY --chown=appuser:appuser` or `RUN chown` before switching USER
- **Prevention**: Always use `--chown` with COPY commands

### Pattern: "no space left on device"
- **Root Cause**: Docker cache/images filling disk
- **Fix**: `docker system prune -a --volumes`
- **Prevention**: Use multi-stage builds, add `.dockerignore`, set up regular cleanup cron

## Terraform Errors

### Pattern: "Error: Cycle" in dependency graph
- **Root Cause**: Two resources reference each other
- **Fix**: Break the cycle with `depends_on` or intermediate data sources
- **Prevention**: Draw dependency graphs before writing complex infrastructure

### Pattern: "Error acquiring the state lock"
- **Root Cause**: Previous `terraform apply` crashed or is still running
- **Fix**: `terraform force-unlock LOCK_ID` (after confirming no other process is running)
- **Prevention**: Use CI/CD for all terraform changes, never run manually in prod

### Pattern: "Provider configuration not present"
- **Root Cause**: Module requires provider that isn't configured
- **Fix**: Pass provider configuration to the module explicitly
- **Prevention**: Always declare required providers in module blocks

## Kubernetes Errors

### Pattern: Pod stuck in "CrashLoopBackOff"
- **Root Cause**: App is crashing on startup
- **Fix**: `kubectl logs POD -n NAMESPACE --previous` to see crash logs
- **Prevention**: Always add health checks and test container locally first

### Pattern: Pod stuck in "Pending"
- **Root Cause**: Insufficient resources or no matching node
- **Fix**: Check `kubectl describe pod` for events. Scale nodes or reduce requests.
- **Prevention**: Set realistic resource requests, use cluster autoscaler

### Pattern: "ImagePullBackOff"
- **Root Cause**: Wrong image name, tag, or missing pull credentials
- **Fix**: Verify image exists, check registry auth, verify imagePullSecrets
- **Prevention**: Use CI/CD to push and tag images consistently

### Pattern: Service not reachable
- **Root Cause**: Labels don't match between Service selector and Pod labels
- **Fix**: Compare `spec.selector` in Service with `metadata.labels` on Pods
- **Prevention**: Use Helm templates or Kustomize to ensure label consistency

## Python Errors

### Pattern: "ModuleNotFoundError"
- **Root Cause**: Package not installed in current environment
- **Fix**: Check virtual env is activated, run `pip install -r requirements.txt`
- **Prevention**: Always use `requirements.txt` or `pyproject.toml` with pinned versions

### Pattern: "ImportError: cannot import name X"
- **Root Cause**: Circular imports or wrong package version
- **Fix**: Move imports inside functions or restructure modules
- **Prevention**: Keep modules loosely coupled, avoid circular dependencies

### Pattern: SQLAlchemy "DetachedInstanceError"
- **Root Cause**: Accessing lazy-loaded attribute outside session scope
- **Fix**: Use `joinedload()` or `selectinload()` to eager-load relationships
- **Prevention**: Always eager-load relationships needed outside the session

## React/TypeScript Errors

### Pattern: "Cannot read properties of undefined"
- **Root Cause**: Accessing nested property before data loads
- **Fix**: Use optional chaining `data?.property?.value` and null checks
- **Prevention**: Always define loading states and handle undefined data

### Pattern: "Too many re-renders"
- **Root Cause**: State update inside render body without dependency guard
- **Fix**: Move state updates into useEffect with correct dependencies
- **Prevention**: Never call setState directly in component body

### Pattern: "Objects are not valid as a React child"
- **Root Cause**: Trying to render an object/array directly in JSX
- **Fix**: Map arrays to JSX elements, stringify objects, or access specific properties
- **Prevention**: Always check data types before rendering

## GitHub Actions Errors

### Pattern: "Permission denied" or "Resource not accessible by integration"
- **Root Cause**: Missing permissions block in workflow
- **Fix**: Add explicit `permissions:` block with required scopes
- **Prevention**: Always declare permissions in every workflow

### Pattern: Cache miss causing slow builds
- **Root Cause**: Cache key doesn't match or cache evicted
- **Fix**: Use content-based cache keys (`hashFiles('**/package-lock.json')`)
- **Prevention**: Design cache keys around lock files, not timestamps

## General Meta-Pattern
```
IF error message contains a file path → check that path exists and has correct permissions
IF error message mentions a port → check nothing else is using that port
IF error message mentions a version → check version compatibility
IF error message mentions authentication → check credentials and token expiry
IF error message mentions timeout → check network connectivity and resource availability
IF error is intermittent → look for race conditions or resource contention
```

FROM node:18-bullseye AS frontend-builder
WORKDIR /app/src/frontend
COPY src/frontend/package*.json ./
RUN npm ci --no-audit --prefer-offline
COPY src/frontend/ ./
RUN npm run build

FROM python:3.11-slim AS runtime
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy backend source and install
COPY pyproject.toml README.md ./
COPY src/augmentedquill/ ./src/augmentedquill/
RUN pip install --no-cache-dir -e .

# Copy built frontend from the builder stage
COPY --from=frontend-builder /app/static/dist ./static/dist
COPY static/images ./static/images

# Create necessary directories
RUN mkdir -p data/projects data/logs resources/config

# Expose the port
EXPOSE 8000

# Run the application
ENTRYPOINT ["augmentedquill", "--host", "0.0.0.0", "--port", "8000"]

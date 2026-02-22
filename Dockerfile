FROM python:3.11-slim
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy backend source and install
COPY pyproject.toml README.md ./
COPY src/augmentedquill/ ./src/augmentedquill/
RUN pip install --no-cache-dir -e .

# Copy pre-built frontend (CI should build `src/frontend/dist` before docker build)
# Fall back to empty directory if dist is not present to avoid build failures.
COPY src/frontend/dist ./static/dist
COPY static/images ./static/images

# Create necessary directories
RUN mkdir -p data/projects data/logs resources/config

# Expose the port
EXPOSE 8000

# Run the application
ENTRYPOINT ["augmentedquill", "--host", "0.0.0.0", "--port", "8000"]

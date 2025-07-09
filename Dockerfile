# Multi-stage build for production optimization
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install curl for health checks
RUN apk add --no-cache curl

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S toko -u 1001

# Set working directory
WORKDIR /app

# Copy built application and dependencies
COPY --from=builder --chown=toko:nodejs /app/dist ./dist
COPY --from=builder --chown=toko:nodejs /app/client/dist ./client/dist
COPY --from=builder --chown=toko:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=toko:nodejs /app/package*.json ./

# Switch to non-root user
USER toko

# Expose port
EXPOSE 5000

# Health check for load balancers
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:5000/api/health || exit 1

# Start the application
CMD ["npm", "start"]
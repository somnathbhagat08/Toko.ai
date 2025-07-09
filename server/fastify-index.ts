import { fastify, httpServer, io } from './fastify-server.js';
import { setupVite, serveStatic, log } from './vite.js';
import type { Server } from 'http';

const isDev = process.env.NODE_ENV === 'development';

async function startServer() {
  try {
    log('Using PostgreSQL with fallback to memory storage', 'database');

    let server: Server;
    
    if (isDev) {
      // Development: Use Vite dev server with Fastify
      server = await setupVite(fastify as any, httpServer);
    } else {
      // Production: Serve static files with Fastify
      serveStatic(fastify as any);
      server = httpServer;
    }

    // Attach Socket.IO to the HTTP server
    io.attach(server);

    const port = parseInt(process.env.PORT || '5000');
    const host = '0.0.0.0';

    // Start the server
    await fastify.listen({ port, host });
    
    log(`🚀 Toko server running on http://${host}:${port}`, 'server');
    log(`📱 Frontend: ${isDev ? 'Development mode with HMR' : 'Production build'}`, 'server');
    log(`🔗 Real-time: Socket.IO enabled`, 'server');
    log(`⚡ Backend: Fastify server ready`, 'server');
  } catch (error) {
    log(`❌ Failed to start server: ${error}`, 'error');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  log('SIGTERM received, shutting down gracefully', 'server');
  await fastify.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  log('SIGINT received, shutting down gracefully', 'server');
  await fastify.close();
  process.exit(0);
});

// Start the server
startServer();
import 'dotenv/config';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createApp } from './app';
import { createRedisConnection } from './config/redis';
import { WebSocketManager } from './websocket/WebSocketManager';
import { OperationService } from './services/operation.service';
import { GitHubService } from './services/github.service';
import { setupGracefulShutdown } from './utils/gracefulShutdown';

async function startServer() {
  try {
    // Inicializar conexões
    const redis = createRedisConnection();
    await redis.connect();

    // Criar serviços
    const operationService = new OperationService(redis);
    const githubService = new GitHubService({
      token: process.env.GITHUB_TOKEN!,
      owner: process.env.GITHUB_OWNER!,
    }, redis);

    // Criar aplicação Express
    const app = createApp({ redis, operationService, githubService });
    const server = createServer(app);
    
    // Configurar Socket.IO
    const io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "*",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    // Configurar WebSocket Manager
    const wsManager = new WebSocketManager(io, redis, operationService);
    wsManager.initialize();

    // Configurar upgrade para WebSocket nativo
    server.on('upgrade', (request, socket, head) => {
      wsManager.handleUpgrade(request, socket, head);
    });

    // Configurar graceful shutdown
    setupGracefulShutdown(server, redis);

    // Iniciar servidor
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`🚀 MyVC Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🗄️  Redis: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`);
      console.log(`🐙 GitHub: ${process.env.GITHUB_OWNER || 'not configured'}`);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
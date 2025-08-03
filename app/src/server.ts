import 'dotenv/config';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createApp } from './app';
import { createRedisConnection } from './config/redis';
import { WebSocketManager } from './websocket/WebSocketManager';
import { OperationService } from './services/operation.service';
import { GitHubService } from './services/github.service';
import { setupGracefulShutdown } from './utils/gracefulShutdown';
import { DatabaseService } from './config/database';
import { ProjectService } from './services/project.services';
import { UserService } from './services/user.services';

async function startServer() {
  try {
    const redis = createRedisConnection();
    await redis.connect();

    const db = new DatabaseService();

    const operationService = new OperationService(redis, db);
    const githubService = new GitHubService({
      token: process.env.GITHUB_TOKEN!,
      owner: process.env.GITHUB_OWNER!,
    }, redis);
    const projectService = new ProjectService(redis, db);
    const userService = new UserService(redis, db);

    const app = createApp({ redis, operationService, githubService, projectService, userService, db});
    const server = createServer(app);
    
    const io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "*",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    const wsManager = new WebSocketManager(io, redis, operationService, projectService);
    wsManager.initialize();

    server.on('upgrade', (request, socket, head) => {
      wsManager.handleUpgrade(request, socket, head);
    });

    setupGracefulShutdown(server, redis);

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
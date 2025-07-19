import 'dotenv/config';
import { createServer } from 'http';
import { createApp } from './app';
import { createRedisConnection } from './config/redis';
import { createSocketIOServer, setupSocketIOEvents } from './websocket/socket';
import { handleNativeWebSocket } from './websocket/nativeWebSocket';
import { setupGracefulShutdown } from './utils/gracefulShutdown';

// Inicializar dependências
const redis = createRedisConnection();
const app = createApp(redis);
const server = createServer(app);
const io = createSocketIOServer(server);

// Configurar WebSocket upgrade handler
server.on('upgrade', (request, socket, head) => {
  if (request.headers.upgrade === 'websocket' && 
      !request.url?.startsWith('/socket.io/')) {
    handleNativeWebSocket(request, socket, head, io, redis);
  }
});

// Configurar eventos Socket.IO
setupSocketIOEvents(io, redis);

// Configurar graceful shutdown
setupGracefulShutdown(server, redis);

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔍 Environment: ${process.env.NODE_ENV}`);
  console.log(`🗄️ Redis host: ${process.env.REDIS_HOST || 'redis'}`);
  console.log(`🗄️ Redis port: ${process.env.REDIS_PORT || '6379'}`);
});
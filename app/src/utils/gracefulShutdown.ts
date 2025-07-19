import { Server as HttpServer } from 'http';
import Redis from 'ioredis';

export const setupGracefulShutdown = (server: HttpServer, redis: Redis) => {
  const shutdown = () => {
    server.close(() => {
      redis.disconnect();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    shutdown();
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    shutdown();
  });
};
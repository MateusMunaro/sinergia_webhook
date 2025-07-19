import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import Redis from 'ioredis';

export const createSocketIOServer = (server: HttpServer) => {
  return new Server(server, {
    cors: {
      origin: '*', // Adjust this to your frontend's URL in production
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type'],
      credentials: true,
    },
    transports: ['websocket'],
    allowEIO3: true,
  });
};

export const setupSocketIOEvents = (io: Server, redis: Redis) => {
  io.on('connection', (socket) => {
    console.log('Socket.IO client connected:', socket.id);
    
    socket.on('operation', async (data) => {
      console.log('Received operation from Socket.IO client:', data);
      
      // Retransmitir para todos os clientes
      socket.broadcast.emit('operation', data);
      
      // Salvar no Redis com tratamento de erro
      try {
        await redis.lpush('operations', JSON.stringify(data));
      } catch (redisError) {
        console.error('Error saving to Redis:', redisError);
      }
    });
    
    socket.on('disconnect', () => {
      console.log('Socket.IO client disconnected:', socket.id);
    });
  });
};
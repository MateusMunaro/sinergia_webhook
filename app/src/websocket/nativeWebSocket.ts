import { Server } from 'socket.io';
import Redis from 'ioredis';

export const handleNativeWebSocket = (request: any, socket: any, head: any, io: Server, redis: Redis) => {
  const WebSocket = require('ws');
  const wss = new WebSocket.Server({ noServer: true });
  
  wss.handleUpgrade(request, socket, head, (ws: any) => {
    console.log('Native WebSocket connection established');
    
    ws.on('message', async (message: string) => {
      try {
        const operation = JSON.parse(message);
        console.log('Received operation:', operation);
        
        // Processar operação e retransmitir via Socket.IO
        io.emit('operation', operation);
        
        // Salvar no Redis com tratamento de erro
        try {
          await redis.lpush('operations', JSON.stringify(operation));
        } catch (redisError) {
          console.error('Error saving to Redis:', redisError);
        }
        
        // Enviar confirmação de volta
        ws.send(JSON.stringify({ 
          type: 'ack', 
          timestamp: Date.now() 
        }));
        
      } catch (error) {
        console.error('Error processing message:', error);
        ws.send(JSON.stringify({ 
          type: 'error', 
          message: 'Invalid JSON' 
        }));
      }
    });
    
    ws.on('close', () => {
      console.log('Native WebSocket connection closed');
    });
    
    ws.on('error', (error: Error) => {
      console.error('WebSocket error:', error);
    });
  });
};
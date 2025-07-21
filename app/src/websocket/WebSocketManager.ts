import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { OperationService } from '../services/operation.service';
import { SocketEvents, Operation } from '../types/app';
import WebSocket, { WebSocketServer } from 'ws'; // Importação corrigida
import { IncomingMessage } from 'http';

export class WebSocketManager {
  private io: Server;
  private redis: Redis;
  private operationService: OperationService;
  private projectUsers: Map<string, Set<string>> = new Map();
  private wss: WebSocketServer;
  private nativeClients: Map<string, WebSocket> = new Map();

  constructor(io: Server, redis: Redis, operationService: OperationService) {
    this.io = io;
    this.redis = redis;
    this.operationService = operationService;
    
    // Inicializar WebSocket Server nativo
    this.wss = new WebSocketServer({ noServer: true });
  }

  initialize() {
    this.setupSocketIO();
    this.setupNativeWebSocket();
    this.setupRedisSync();
  }

  private setupSocketIO() {
    this.io.on('connection', (socket: Socket) => {
      console.log(`🔌 Socket.IO Client connected: ${socket.id}`);
      
      this.setupSocketEvents(socket);
      
      socket.on('disconnect', () => {
        console.log(`🔌 Socket.IO Client disconnected: ${socket.id}`);
        this.handleDisconnection(socket);
      });
    });
  }

  private setupNativeWebSocket() {
    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      const clientId = this.generateClientId();
      this.nativeClients.set(clientId, ws);
      
      console.log(`🔌 Native WebSocket Client connected: ${clientId}`);
      
      ws.on('message', async (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleNativeMessage(ws, clientId, message);
        } catch (error) {
          console.error('❌ Error processing native WebSocket message:', error);
          this.sendNativeMessage(ws, { 
            type: 'error', 
            message: 'Invalid JSON format' 
          });
        }
      });

      ws.on('close', () => {
        console.log(`🔌 Native WebSocket Client disconnected: ${clientId}`);
        this.handleNativeDisconnection(clientId);
      });

      ws.on('error', (error) => {
        console.error(`❌ Native WebSocket error for client ${clientId}:`, error);
      });

      // Enviar confirmação de conexão
      this.sendNativeMessage(ws, {
        type: 'connection-ack',
        clientId: clientId,
        timestamp: Date.now()
      });
    });
  }

  // Método para lidar com upgrade de conexão HTTP para WebSocket
  handleUpgrade(request: IncomingMessage, socket: any, head: Buffer) {
    this.wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      this.wss.emit('connection', ws, request);
    });
  }

  private async handleNativeMessage(ws: WebSocket, clientId: string, message: any) {
    const { type, data } = message;

    switch (type) {
      case 'join-project':
        await this.handleNativeJoinProject(ws, clientId, data.projectId);
        break;
        
      case 'leave-project':
        await this.handleNativeLeaveProject(ws, clientId, data.projectId);
        break;
        
      case 'operation':
        await this.handleNativeOperation(ws, clientId, data);
        break;
        
      case 'sync-request':
        await this.handleNativeSyncRequest(ws, clientId, data);
        break;
        
      case 'ping':
        this.sendNativeMessage(ws, { type: 'pong', timestamp: Date.now() });
        break;
        
      default:
        this.sendNativeMessage(ws, {
          type: 'error',
          message: `Unknown message type: ${type}`
        });
    }
  }

  private async handleNativeJoinProject(ws: WebSocket, clientId: string, projectId: string) {
    try {
      // Adicionar cliente nativo ao projeto
      if (!this.projectUsers.has(projectId)) {
        this.projectUsers.set(projectId, new Set());
      }
      this.projectUsers.get(projectId)!.add(clientId);
      
      // Obter estado atual do projeto
      const version = await this.operationService.getProjectVersion(projectId);
      const usersOnline = Array.from(this.projectUsers.get(projectId) || []);
      
      // Enviar estado para cliente nativo
      this.sendNativeMessage(ws, {
        type: 'project-state',
        data: {
          projectId,
          usersOnline,
          files: [], // TODO: implementar listagem de arquivos
          version
        }
      });
      
      // Notificar clientes Socket.IO
      this.io.to(`project:${projectId}`).emit('project-state', {
        usersOnline,
        files: [],
        version
      });
      
      console.log(`👥 Native client ${clientId} joined project ${projectId}`);
      
    } catch (error) {
      console.error('❌ Error joining project (native):', error);
      this.sendNativeMessage(ws, {
        type: 'error',
        message: 'Failed to join project'
      });
    }
  }

  private async handleNativeLeaveProject(ws: WebSocket, clientId: string, projectId: string) {
    if (this.projectUsers.has(projectId)) {
      this.projectUsers.get(projectId)!.delete(clientId);
      
      const usersOnline = Array.from(this.projectUsers.get(projectId) || []);
      
      // Notificar outros clientes
      this.io.to(`project:${projectId}`).emit('project-state', {
        usersOnline,
        files: [],
        version: 0 // TODO: buscar versão real
      });
    }
    
    this.sendNativeMessage(ws, {
      type: 'leave-project-ack',
      data: { projectId }
    });
    
    console.log(`👥 Native client ${clientId} left project ${projectId}`);
  }

  private async handleNativeOperation(ws: WebSocket, clientId: string, operationData: any) {
    try {
      const operation = await this.operationService.saveOperation(operationData);
      
      // Broadcast para clientes Socket.IO
      this.io.to(`project:${operation.projectId}`).emit('operation-broadcast', operation);
      
      // Broadcast para outros clientes nativos do mesmo projeto
      this.broadcastToNativeClients(operation.projectId, {
        type: 'operation-broadcast',
        data: operation
      }, clientId);
      
      // Salvar no Redis pub/sub para outros servidores
      await this.redis.publish('operation-sync', JSON.stringify(operation));
      
      // Enviar confirmação para o cliente que enviou
      this.sendNativeMessage(ws, {
        type: 'operation-ack',
        data: { operationId: operation.id, timestamp: Date.now() }
      });
      
    } catch (error) {
      console.error('❌ Error processing native operation:', error);
      this.sendNativeMessage(ws, {
        type: 'error',
        message: 'Failed to process operation'
      });
    }
  }

  private async handleNativeSyncRequest(ws: WebSocket, clientId: string, data: any) {
    try {
      const { projectId, lastKnownVersion } = data;
      const result = await this.operationService.getOperationsSinceVersion(
        projectId, 
        lastKnownVersion
      );
      
      this.sendNativeMessage(ws, {
        type: 'sync-response',
        data: result
      });
      
    } catch (error) {
      console.error('❌ Error handling native sync request:', error);
      this.sendNativeMessage(ws, {
        type: 'error',
        message: 'Failed to sync'
      });
    }
  }

  private sendNativeMessage(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private broadcastToNativeClients(projectId: string, message: any, excludeClientId?: string) {
    const projectUsers = this.projectUsers.get(projectId);
    if (!projectUsers) return;
    
    projectUsers.forEach(clientId => {
      if (clientId !== excludeClientId) {
        const client = this.nativeClients.get(clientId);
        if (client) {
          this.sendNativeMessage(client, message);
        }
      }
    });
  }

  private handleNativeDisconnection(clientId: string) {
    // Remover cliente de todos os projetos
    for (const [projectId, users] of this.projectUsers.entries()) {
      if (users.has(clientId)) {
        users.delete(clientId);
        
        // Notificar outros usuários
        const usersOnline = Array.from(users);
        this.io.to(`project:${projectId}`).emit('project-state', {
          usersOnline,
          files: [],
          version: 0 // TODO: buscar versão real
        });
      }
    }
    
    // Remover da lista de clientes nativos
    this.nativeClients.delete(clientId);
  }

  private generateClientId(): string {
    return `native_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ...existing code... (setupSocketEvents, setupRedisSync, leaveProject, handleDisconnection methods remain the same)

  private setupSocketEvents(socket: Socket) {
    // Cliente junta-se a um projeto
    socket.on('join-project', async (projectId: string) => {
      try {
        await socket.join(`project:${projectId}`);
        
        // Adicionar usuário à lista do projeto
        if (!this.projectUsers.has(projectId)) {
          this.projectUsers.set(projectId, new Set());
        }
        this.projectUsers.get(projectId)!.add(socket.id);
        
        // Enviar estado atual do projeto
        const version = await this.operationService.getProjectVersion(projectId);
        const usersOnline = Array.from(this.projectUsers.get(projectId) || []);
        
        socket.emit('project-state', {
          usersOnline,
          files: [], // TODO: implementar listagem de arquivos
          version
        });
        
        // Notificar outros usuários
        socket.to(`project:${projectId}`).emit('project-state', {
          usersOnline,
          files: [],
          version
        });
        
        console.log(`👥 User ${socket.id} joined project ${projectId}`);
        
      } catch (error) {
        console.error('❌ Error joining project:', error);
        socket.emit('error', { message: 'Failed to join project' });
      }
    });

    // Cliente sai do projeto
    socket.on('leave-project', (projectId: string) => {
      this.leaveProject(socket, projectId);
    });

    // Receber operação
    socket.on('operation', async (operationData) => {
      try {
        const operation = await this.operationService.saveOperation(operationData);
        
        // Broadcast para todos os clientes do projeto (exceto o remetente)
        socket.to(`project:${operation.projectId}`).emit('operation-broadcast', operation);
        
        // Broadcast para clientes nativos
        this.broadcastToNativeClients(operation.projectId, {
          type: 'operation-broadcast',
          data: operation
        });
        
        // Salvar no Redis pub/sub para outros servidores
        await this.redis.publish('operation-sync', JSON.stringify(operation));
        
      } catch (error) {
        console.error('❌ Error processing operation:', error);
        socket.emit('error', { message: 'Failed to process operation' });
      }
    });

    // Solicitação de sincronização
    socket.on('sync-request', async (data: { projectId: string; file: string; lastKnownVersion: number }) => {
      try {
        const result = await this.operationService.getOperationsSinceVersion(
          data.projectId, 
          data.lastKnownVersion
        );
        
        socket.emit('sync-response', result);
        
      } catch (error) {
        console.error('❌ Error handling sync request:', error);
        socket.emit('error', { message: 'Failed to sync' });
      }
    });
  }

  private setupRedisSync() {
    // Criar cliente Redis separado para pub/sub
    const pubsubRedis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379')
    });

    pubsubRedis.subscribe('operation-sync', (err) => {
      if (err) {
        console.error('❌ Error subscribing to Redis:', err);
      } else {
        console.log('✅ Subscribed to operation-sync channel');
      }
    });

    pubsubRedis.on('message', (channel, message) => {
      if (channel === 'operation-sync') {
        try {
          const operation: Operation = JSON.parse(message);
          
          // Broadcast para todos os clientes Socket.IO do projeto
          this.io.to(`project:${operation.projectId}`).emit('operation-broadcast', operation);
          
          // Broadcast para clientes nativos
          this.broadcastToNativeClients(operation.projectId, {
            type: 'operation-broadcast',
            data: operation
          });
          
        } catch (error) {
          console.error('❌ Error processing Redis message:', error);
        }
      }
    });
  }

  private leaveProject(socket: Socket, projectId: string) {
    socket.leave(`project:${projectId}`);
    
    // Remover usuário da lista do projeto
    if (this.projectUsers.has(projectId)) {
      this.projectUsers.get(projectId)!.delete(socket.id);
      
      // Notificar outros usuários
      const usersOnline = Array.from(this.projectUsers.get(projectId) || []);
      socket.to(`project:${projectId}`).emit('project-state', {
        usersOnline,
        files: [],
        version: 0 // TODO: buscar versão real
      });
    }
    
    console.log(`👥 User ${socket.id} left project ${projectId}`);
  }

  private handleDisconnection(socket: Socket) {
    // Remover usuário de todos os projetos
    for (const [projectId, users] of this.projectUsers.entries()) {
      if (users.has(socket.id)) {
        this.leaveProject(socket, projectId);
      }
    }
  }
}
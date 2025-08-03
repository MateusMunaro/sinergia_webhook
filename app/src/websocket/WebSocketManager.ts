// src/websocket/WebSocketManager.ts - Melhorado para protocolo MyVC
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { OperationService } from '../services/operation.service';
import { ProjectService } from '../services/project.services';
import { WebSocketMessage, MyVCOperation, AuthenticationRequest, ProjectJoinRequest } from '../types/app';

interface ClientSession {
  id: string;
  userId?: string;
  username?: string;
  projectId?: string;
  authenticated: boolean;
  lastPing: number;
}

export class WebSocketManager {
  private io: Server;
  private redis: Redis;
  private operationService: OperationService;
  private projectService: ProjectService;
  private wss: WebSocketServer;
  
  // Mapas para gerenciar clientes nativos
  private nativeClients: Map<string, WebSocket> = new Map();
  private clientSessions: Map<string, ClientSession> = new Map();
  private projectUsers: Map<string, Set<string>> = new Map();
  
  // Heartbeat interval (30 segundos)
  private heartbeatInterval: NodeJS.Timeout;

  constructor(
    io: Server, 
    redis: Redis, 
    operationService: OperationService,
    projectService: ProjectService
  ) {
    this.io = io;
    this.redis = redis;
    this.operationService = operationService;
    this.projectService = projectService;
    
    this.wss = new WebSocketServer({ noServer: true });
    this.startHeartbeat();
  }

  initialize() {
    this.setupSocketIO();
    this.setupNativeWebSocket();
    this.setupRedisSync();
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      this.clientSessions.forEach((session, clientId) => {
        if (now - session.lastPing > 60000) { // 1 minuto timeout
          console.log(`⏰ Client ${clientId} timed out`);
          this.disconnectNativeClient(clientId);
        }
      });
    }, 30000);
  }

  // NATIVE WEBSOCKET (Protocolo MyVC)
  private setupNativeWebSocket() {
    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      const clientId = this.generateClientId();
      this.nativeClients.set(clientId, ws);
      
      const session: ClientSession = {
        id: clientId,
        authenticated: false,
        lastPing: Date.now()
      };
      this.clientSessions.set(clientId, session);
      
      console.log(`🔌 MyVC Client connected: ${clientId}`);
      
      ws.on('message', async (data: WebSocket.Data) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          await this.handleNativeMessage(ws, clientId, message);
        } catch (error) {
          console.error('❌ Error processing native message:', error);
          this.sendNativeMessage(ws, {
            type: 'error',
            timestamp: Date.now(),
            data: { message: 'Invalid JSON format', code: 'INVALID_JSON' }
          });
        }
      });

      ws.on('close', () => {
        this.disconnectNativeClient(clientId);
      });

      ws.on('error', (error) => {
        console.error(`❌ Native WebSocket error for client ${clientId}:`, error);
        this.disconnectNativeClient(clientId);
      });
    });
  }

  private async handleNativeMessage(ws: WebSocket, clientId: string, message: WebSocketMessage) {
    const session = this.clientSessions.get(clientId);
    if (!session) return;

    session.lastPing = Date.now();

    switch (message.type) {
      case 'authenticate':
        await this.handleAuthentication(ws, clientId, message.data as AuthenticationRequest);
        break;
        
      case 'join-project':
        if (!session.authenticated) {
          this.sendNativeMessage(ws, {
            type: 'error',
            timestamp: Date.now(),
            data: { message: 'Authentication required', code: 'AUTH_REQUIRED' }
          });
          return;
        }
        await this.handleJoinProject(ws, clientId, message.data as ProjectJoinRequest);
        break;
        
      case 'operation':
        if (!session.authenticated || !session.projectId) {
          this.sendNativeMessage(ws, {
            type: 'error',
            timestamp: Date.now(),
            data: { message: 'Not joined to project', code: 'NO_PROJECT' }
          });
          return;
        }
        await this.handleOperation(ws, clientId, message.data as MyVCOperation);
        break;
        
      case 'ping':
        this.sendNativeMessage(ws, { 
          type: 'pong', 
          timestamp: Date.now() 
        });
        break;
        
      default:
        this.sendNativeMessage(ws, {
          type: 'error',
          timestamp: Date.now(),
          data: { message: `Unknown message type: ${message.type}`, code: 'UNKNOWN_TYPE' }
        });
    }
  }

  private async handleAuthentication(ws: WebSocket, clientId: string, data: AuthenticationRequest) {
    const session = this.clientSessions.get(clientId);
    if (!session) return;

    try {
      // TODO: Implementar autenticação real com banco de dados
      // Por agora, aceitar qualquer username/password para desenvolvimento
      if (data.username && data.password) {
        session.authenticated = true;
        session.username = data.username;
        session.userId = `user_${data.username}`; // Temporário
        
        this.sendNativeMessage(ws, {
          type: 'auth-response',
          timestamp: Date.now(),
          data: {
            status: 'success',
            message: 'Authentication successful',
            userId: session.userId
          }
        });
        
        console.log(`✅ Client ${clientId} authenticated as ${data.username}`);
      } else {
        this.sendNativeMessage(ws, {
          type: 'auth-response',
          timestamp: Date.now(),
          data: {
            status: 'failed',
            message: 'Invalid credentials'
          }
        });
      }
    } catch (error) {
      console.error('❌ Authentication error:', error);
      this.sendNativeMessage(ws, {
        type: 'auth-response',
        timestamp: Date.now(),
        data: {
          status: 'failed',
          message: 'Authentication failed'
        }
      });
    }
  }

  private async handleJoinProject(ws: WebSocket, clientId: string, data: ProjectJoinRequest) {
    const session = this.clientSessions.get(clientId);
    if (!session || !session.userId) return;

    try {
      // Verificar se projeto existe e usuário tem permissão
      const project = await this.projectService.getProject(data.projectId);
      if (!project) {
        this.sendNativeMessage(ws, {
          type: 'project-join-response',
          timestamp: Date.now(),
          data: {
            status: 'failed',
            message: 'Project not found'
          }
        });
        return;
      }

      // TODO: Verificar permissões reais
      // const permission = await this.projectService.checkUserPermission(data.projectId, session.userId);

      session.projectId = data.projectId;
      
      // Adicionar à lista de usuários do projeto
      if (!this.projectUsers.has(data.projectId)) {
        this.projectUsers.set(data.projectId, new Set());
      }
      this.projectUsers.get(data.projectId)!.add(clientId);

      const participants = Array.from(this.projectUsers.get(data.projectId) || [])
        .map(cId => this.clientSessions.get(cId)?.username)
        .filter(Boolean);

      this.sendNativeMessage(ws, {
        type: 'project-join-response',
        timestamp: Date.now(),
        data: {
          status: 'success',
          message: 'Successfully joined project',
          projectId: data.projectId,
          participants
        }
      });

      console.log(`👥 Client ${clientId} joined project ${data.projectId}`);
      
    } catch (error) {
      console.error('❌ Error joining project:', error);
      this.sendNativeMessage(ws, {
        type: 'project-join-response',
        timestamp: Date.now(),
        data: {
          status: 'failed',
          message: 'Failed to join project'
        }
      });
    }
  }

  private async handleOperation(ws: WebSocket, clientId: string, data: MyVCOperation) {
    const session = this.clientSessions.get(clientId);
    if (!session || !session.projectId || !session.userId) return;

    try {
      // Converter operação MyVC para formato interno
      const operation = await this.operationService.saveOperation({
        type: data.op_type === 'create' ? 'insert' : data.op_type,
        file: data.file || 'unknown', // Para operações create
        line: data.line,
        column: data.column,
        text: data.text,
        author: session.userId,
        projectId: session.projectId
      });

      // Enviar ACK para o cliente
      this.sendNativeMessage(ws, {
        type: 'operation-ack',
        timestamp: Date.now(),
        data: {
          status: 'received',
          operationId: operation.id
        }
      });

      // Broadcast para outros clientes do projeto
      this.broadcastToProject(session.projectId, {
        type: 'operation-broadcast',
        timestamp: Date.now(),
        data: {
          operation: {
            op_type: operation.type,
            line: operation.line,
            column: operation.column,
            text: operation.text,
            author: session.username || 'unknown',
            timestamp: operation.timestamp
          }
        }
      }, clientId);

      // Publicar no Redis para outros servidores
      await this.redis.publish('operation-sync', JSON.stringify(operation));
      
    } catch (error) {
      console.error('❌ Error processing operation:', error);
      this.sendNativeMessage(ws, {
        type: 'error',
        timestamp: Date.now(),
        data: {
          message: 'Failed to process operation',
          code: 'OPERATION_FAILED'
        }
      });
    }
  }

  private broadcastToProject(projectId: string, message: WebSocketMessage, excludeClientId?: string) {
    const projectUsers = this.projectUsers.get(projectId);
    if (!projectUsers) return;
    
    projectUsers.forEach(clientId => {
      if (clientId !== excludeClientId) {
        const client = this.nativeClients.get(clientId);
        const session = this.clientSessions.get(clientId);
        
        if (client && session?.authenticated) {
          this.sendNativeMessage(client, message);
        }
      }
    });

    // Também broadcast via Socket.IO
    this.io.to(`project:${projectId}`).emit('operation-broadcast', message.data);
  }

  private sendNativeMessage(ws: WebSocket, message: WebSocketMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private disconnectNativeClient(clientId: string) {
    const session = this.clientSessions.get(clientId);
    
    // Remover de todos os projetos
    if (session?.projectId) {
      const projectUsers = this.projectUsers.get(session.projectId);
      if (projectUsers) {
        projectUsers.delete(clientId);
        if (projectUsers.size === 0) {
          this.projectUsers.delete(session.projectId);
        }
      }
    }
    
    // Limpar dados do cliente
    this.nativeClients.delete(clientId);
    this.clientSessions.delete(clientId);
    
    console.log(`🔌 MyVC Client disconnected: ${clientId}`);
  }

  handleUpgrade(request: IncomingMessage, socket: any, head: Buffer) {
    this.wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      this.wss.emit('connection', ws, request);
    });
  }

  // SOCKET.IO (Interface Web)
  private setupSocketIO() {
    this.io.on('connection', (socket: Socket) => {
      console.log(`🌐 Socket.IO Client connected: ${socket.id}`);
      
      socket.on('join-project', async (projectId: string) => {
        await socket.join(`project:${projectId}`);
        console.log(`👥 Socket.IO client ${socket.id} joined project ${projectId}`);
      });

      socket.on('operation', async (operationData) => {
        try {
          const operation = await this.operationService.saveOperation(operationData);
          socket.to(`project:${operation.projectId}`).emit('operation-broadcast', operation);
          await this.redis.publish('operation-sync', JSON.stringify(operation));
        } catch (error) {
          console.error('❌ Socket.IO operation error:', error);
          socket.emit('error', { message: 'Failed to process operation' });
        }
      });
      
      socket.on('disconnect', () => {
        console.log(`🌐 Socket.IO Client disconnected: ${socket.id}`);
      });
    });
  }

  // REDIS SYNC
  private setupRedisSync() {
    const pubsubRedis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379')
    });

    pubsubRedis.subscribe('operation-sync');
    pubsubRedis.on('message', (channel, message) => {
      if (channel === 'operation-sync') {
        try {
          const operation = JSON.parse(message);
          
          // Broadcast para Socket.IO
          this.io.to(`project:${operation.projectId}`).emit('operation-broadcast', operation);
          
          // Broadcast para clientes nativos MyVC
          this.broadcastToProject(operation.projectId, {
            type: 'operation-broadcast',
            timestamp: Date.now(),
            data: { operation }
          });
          
        } catch (error) {
          console.error('❌ Redis sync error:', error);
        }
      }
    });
  }

  private generateClientId(): string {
    return `myvc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Cleanup
  destroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.nativeClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    });
    
    this.nativeClients.clear();
    this.clientSessions.clear();
    this.projectUsers.clear();
  }
}
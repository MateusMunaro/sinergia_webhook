// src/types/app.ts - Atualizado
import Redis from 'ioredis';
import { OperationService } from '../services/operation.service';
import { GitHubService } from '../services/github.service';
import { ProjectService } from '../services/project.services';
import { DatabaseService } from '../config/database';
import { UserService } from '../services/user.services';

export interface AppDependencies {
  redis: Redis;
  db: DatabaseService;
  operationService: OperationService;
  githubService: GitHubService;
  projectService: ProjectService;
  userService: UserService;
}

// Estruturas de dados do sistema
export interface Operation {
  id: string;
  type: 'insert' | 'delete' | 'replace';
  file: string;
  line: number;
  column: number;
  text: string;
  author: string; // UUID do usuário
  timestamp: number;
  projectId: string;
  version: number;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  githubRepo?: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  name: string;
  email: string;
  githubUsername?: string;
  password?: string; // Opcional, se for usado para autenticação
  createdAt: Date;
}

export interface ProjectUser {
  projectId: string;
  userId: string;
  role: 'owner' | 'write' | 'read';
  email?: string;
  githubUsername?: string;
}

export interface Snapshot {
  id: string;
  projectId: string;
  file: string;
  content: string;
  version: number;
  timestamp: number;
}

// GitHub Integration
export interface GitHubConfig {
  token: string;
  owner: string;
}

export interface CommitData {
  message: string;
  files: Array<{
    path: string;
    content: string;
  }>;
}

// WebSocket Protocol - Compatível com cliente C
export interface WebSocketMessage {
  type: 'authenticate' | 'join-project' | 'operation' | 'ping' | 'auth-response' | 
        'project-join-response' | 'operation-broadcast' | 'operation-ack' | 'error' | 'pong';
  timestamp: number;
  data?: any;
}

// Protocolo MyVC (compatível com cliente C)
export interface MyVCOperation {
  op_type: 'insert' | 'delete' | 'replace' | 'create';
  line: number;
  column: number;
  text: string;
  author: string;
  timestamp: number;
  file?: string; // Para operações create
}

export interface AuthenticationRequest {
  username: string;
  password: string;
}

export interface ProjectJoinRequest {
  projectId: string;
}

import Redis from 'ioredis';
import { OperationService } from '../services/operation.service';
import { GitHubService } from '../services/github.service';

export interface AppDependencies {
  redis: Redis;
  operationService: OperationService;
  githubService: GitHubService;
}

// Estruturas de dados do sistema
export interface Operation {
  id: string;
  type: 'insert' | 'delete' | 'replace';
  file: string;
  line: number;
  column: number;
  text: string;
  author: string;
  timestamp: number;
  projectId: string;
  version?: number;
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
  email: string;
  githubUsername?: string;
  createdAt: Date;
}

export interface ProjectUser {
  projectId: string;
  userId: string;
  role: 'owner' | 'write' | 'read';
}

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

// WebSocket Events
export interface SocketEvents {
  // Client to Server
  'join-project': (projectId: string) => void;
  'leave-project': (projectId: string) => void;
  'operation': (operation: Omit<Operation, 'id' | 'timestamp'>) => void;
  'sync-request': (data: { file: string; lastKnownVersion: number }) => void;

  // Server to Client
  'operation-broadcast': (operation: Operation) => void;
  'project-state': (state: { usersOnline: string[]; files: string[]; version: number }) => void;
  'sync-response': (data: { operations: Operation[]; currentVersion: number }) => void;
  'error': (error: { message: string; code?: string }) => void;
}
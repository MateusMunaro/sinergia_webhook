import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { Operation } from '../types/app';

export class OperationService {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Salva uma operação no Redis
   */
  async saveOperation(operation: Omit<Operation, 'id' | 'timestamp'>): Promise<Operation> {
    const fullOperation: Operation = {
      ...operation,
      id: uuidv4(),
      timestamp: Date.now()
    };

    try {
      // Salvar na lista geral de operações
      await this.redis.lpush('operations', JSON.stringify(fullOperation));
      
      // Salvar na lista específica do projeto
      await this.redis.lpush(
        `operations:${operation.projectId}`, 
        JSON.stringify(fullOperation)
      );
      
      // Salvar na lista específica do arquivo
      await this.redis.lpush(
        `operations:${operation.projectId}:${operation.file}`, 
        JSON.stringify(fullOperation)
      );

      // Atualizar contador de versão do projeto
      await this.redis.incr(`version:${operation.projectId}`);
      
      console.log(`✅ Operation saved: ${fullOperation.type} on ${fullOperation.file}`);
      return fullOperation;
      
    } catch (error) {
      console.error('❌ Error saving operation:', error);
      throw new Error('Failed to save operation');
    }
  }

  /**
   * Busca operações por projeto
   */
  async getOperationsByProject(projectId: string, limit: number = 100): Promise<Operation[]> {
    try {
      const operations = await this.redis.lrange(`operations:${projectId}`, 0, limit - 1);
      return operations.map(op => JSON.parse(op)).reverse(); // Mais antigas primeiro
    } catch (error) {
      console.error('❌ Error getting operations by project:', error);
      return [];
    }
  }

  /**
   * Busca operações por arquivo específico
   */
  async getOperationsByFile(projectId: string, file: string, limit: number = 100): Promise<Operation[]> {
    try {
      const operations = await this.redis.lrange(
        `operations:${projectId}:${file}`, 
        0, 
        limit - 1
      );
      return operations.map(op => JSON.parse(op)).reverse();
    } catch (error) {
      console.error('❌ Error getting operations by file:', error);
      return [];
    }
  }

  /**
   * Busca todas as operações (para commit)
   */
  async getAllOperations(limit: number = 1000): Promise<Operation[]> {
    try {
      const operations = await this.redis.lrange('operations', 0, limit - 1);
      return operations.map(op => JSON.parse(op)).reverse();
    } catch (error) {
      console.error('❌ Error getting all operations:', error);
      return [];
    }
  }

  /**
   * Limpa operações após commit
   */
  async clearOperations(): Promise<void> {
    try {
      await this.redis.del('operations');
      console.log('✅ All operations cleared');
    } catch (error) {
      console.error('❌ Error clearing operations:', error);
      throw new Error('Failed to clear operations');
    }
  }

  /**
   * Limpa operações de um projeto específico
   */
  async clearProjectOperations(projectId: string): Promise<void> {
    try {
      await this.redis.del(`operations:${projectId}`);
      console.log(`✅ Operations cleared for project: ${projectId}`);
    } catch (error) {
      console.error('❌ Error clearing project operations:', error);
      throw new Error('Failed to clear project operations');
    }
  }

  /**
   * Obtém versão atual do projeto
   */
  async getProjectVersion(projectId: string): Promise<number> {
    try {
      const version = await this.redis.get(`version:${projectId}`);
      return version ? parseInt(version) : 0;
    } catch (error) {
      console.error('❌ Error getting project version:', error);
      return 0;
    }
  }

  /**
   * Busca operações a partir de uma versão específica
   */
  async getOperationsSinceVersion(
    projectId: string, 
    since: number, 
    limit: number = 100
  ): Promise<{ operations: Operation[]; currentVersion: number }> {
    try {
      const operations = await this.getOperationsByProject(projectId, limit);
      const filteredOperations = operations.filter(op => 
        op.version && op.version > since
      );
      
      const currentVersion = await this.getProjectVersion(projectId);
      
      return {
        operations: filteredOperations,
        currentVersion
      };
    } catch (error) {
      console.error('❌ Error getting operations since version:', error);
      return { operations: [], currentVersion: 0 };
    }
  }

  /**
   * Salva snapshot de um arquivo
   */
  async saveSnapshot(projectId: string, file: string, content: string): Promise<void> {
    try {
      const snapshot = {
        projectId,
        file,
        content,
        timestamp: Date.now(),
        version: await this.getProjectVersion(projectId)
      };

      await this.redis.set(
        `snapshot:${projectId}:${file}`, 
        JSON.stringify(snapshot)
      );
      
      console.log(`✅ Snapshot saved for ${file} in project ${projectId}`);
    } catch (error) {
      console.error('❌ Error saving snapshot:', error);
      throw new Error('Failed to save snapshot');
    }
  }

  /**
   * Busca snapshot de um arquivo
   */
  async getSnapshot(projectId: string, file: string): Promise<any> {
    try {
      const snapshot = await this.redis.get(`snapshot:${projectId}:${file}`);
      return snapshot ? JSON.parse(snapshot) : null;
    } catch (error) {
      console.error('❌ Error getting snapshot:', error);
      return null;
    }
  }
}
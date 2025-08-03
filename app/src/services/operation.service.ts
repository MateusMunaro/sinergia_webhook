// src/services/operation.service.ts
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../config/database';
import { Operation, Project, Snapshot } from '../types/app';

export class OperationService {
  private redis: Redis;
  private db: DatabaseService;

  constructor(redis: Redis, db: DatabaseService) {
    this.redis = redis;
    this.db = db;
  }

  /**
   * Salva operação no Redis (tempo real) e PostgreSQL (persistência)
   */
  async saveOperation(operation: Omit<Operation, 'id' | 'timestamp' | 'version'>): Promise<Operation> {
    const version = await this.getProjectVersion(operation.projectId);
    const fullOperation: Operation = {
      ...operation,
      id: uuidv4(),
      timestamp: Date.now(),
      version: version + 1
    };

    try {
      // Usar transação para garantir consistência
      await this.db.transaction(async (client) => {
        // 1. Salvar no PostgreSQL
        await client.query(`
          INSERT INTO operations (
            id, project_id, file_path, op_type, line_number, 
            column_number, content, author_id, timestamp, version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          fullOperation.id,
          fullOperation.projectId,
          fullOperation.file,
          fullOperation.type,
          fullOperation.line,
          fullOperation.column,
          fullOperation.text,
          fullOperation.author, // Assumindo que é UUID do usuário
          fullOperation.timestamp,
          fullOperation.version
        ]);

        // 2. Atualizar projeto no PostgreSQL
        await client.query(`
          UPDATE projects 
          SET updated_at = CURRENT_TIMESTAMP 
          WHERE id = $1
        `, [fullOperation.projectId]);
      });

      // 3. Cache no Redis para acesso rápido
      await Promise.all([
        // Lista geral (para WebSocket/tempo real)
        this.redis.lpush('operations', JSON.stringify(fullOperation)),
        
        // Lista por projeto
        this.redis.lpush(`operations:${operation.projectId}`, JSON.stringify(fullOperation)),
        
        // Lista por arquivo
        this.redis.lpush(`operations:${operation.projectId}:${operation.file}`, JSON.stringify(fullOperation)),
        
        // Atualizar versão do projeto
        this.redis.set(`version:${operation.projectId}`, fullOperation.version),
        
        // TTL para limpeza automática do cache (24 horas)
        this.redis.expire('operations', 86400),
        this.redis.expire(`operations:${operation.projectId}`, 86400)
      ]);

      console.log(`✅ Operation saved: ${fullOperation.type} on ${fullOperation.file} (v${fullOperation.version})`);
      return fullOperation;
      
    } catch (error) {
      console.error('❌ Error saving operation:', error);
      throw new Error('Failed to save operation');
    }
  }

  /**
   * Busca operações por projeto (Redis primeiro, fallback PostgreSQL)
   */
  async getOperationsByProject(projectId: string, limit: number = 100): Promise<Operation[]> {
    try {
      // Tentar cache Redis primeiro
      const cached = await this.redis.lrange(`operations:${projectId}`, 0, limit - 1);
      
      if (cached.length > 0) {
        console.log(`📋 Retrieved ${cached.length} operations from Redis cache`);
        return cached.map(op => JSON.parse(op)).reverse();
      }

      // Fallback para PostgreSQL
      console.log(`📋 Cache miss, querying PostgreSQL for project ${projectId}`);
      const result = await this.db.query(`
        SELECT 
          id, project_id, file_path as file, op_type as type,
          line_number as line, column_number as "column", content as text,
          author_id as author, timestamp, version
        FROM operations 
        WHERE project_id = $1 
        ORDER BY timestamp DESC 
        LIMIT $2
      `, [projectId, limit]);

      const operations = result.rows.reverse(); // Mais antigas primeiro
      
      // Atualizar cache Redis
      if (operations.length > 0) {
        const pipeline = this.redis.pipeline();
        operations.forEach(op => {
          pipeline.lpush(`operations:${projectId}`, JSON.stringify(op));
        });
        pipeline.expire(`operations:${projectId}`, 3600); // 1 hora
        await pipeline.exec();
      }

      return operations;
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
      // Cache Redis primeiro
      const cacheKey = `operations:${projectId}:${file}`;
      const cached = await this.redis.lrange(cacheKey, 0, limit - 1);
      
      if (cached.length > 0) {
        return cached.map(op => JSON.parse(op)).reverse();
      }

      // PostgreSQL fallback
      const result = await this.db.query(`
        SELECT 
          id, project_id, file_path as file, op_type as type,
          line_number as line, column_number as "column", content as text,
          author_id as author, timestamp, version
        FROM operations 
        WHERE project_id = $1 AND file_path = $2
        ORDER BY timestamp DESC 
        LIMIT $3
      `, [projectId, file, limit]);

      const operations = result.rows.reverse();
      
      // Cache no Redis
      if (operations.length > 0) {
        const pipeline = this.redis.pipeline();
        operations.forEach(op => {
          pipeline.lpush(cacheKey, JSON.stringify(op));
        });
        pipeline.expire(cacheKey, 1800); // 30 minutos
        await pipeline.exec();
      }

      return operations;
    } catch (error) {
      console.error('❌ Error getting operations by file:', error);
      return [];
    }
  }

  /**
   * Versão do projeto (Redis com fallback PostgreSQL)
   */
  async getProjectVersion(projectId: string): Promise<number> {
    try {
      // Tentar cache Redis primeiro
      const cachedVersion = await this.redis.get(`version:${projectId}`);
      if (cachedVersion !== null) {
        return parseInt(cachedVersion);
      }

      // Buscar no PostgreSQL
      const result = await this.db.query(`
        SELECT COALESCE(MAX(version), 0) as max_version 
        FROM operations 
        WHERE project_id = $1
      `, [projectId]);

      const version = result.rows[0]?.max_version || 0;
      
      // Atualizar cache
      await this.redis.set(`version:${projectId}`, version, 'EX', 3600);
      
      return version;
    } catch (error) {
      console.error('❌ Error getting project version:', error);
      return 0;
    }
  }

  /**
   * Sincronização desde versão específica
   */
  async getOperationsSinceVersion(
    projectId: string, 
    since: number, 
    limit: number = 100
  ): Promise<{ operations: Operation[]; currentVersion: number }> {
    try {
      const result = await this.db.query(`
        SELECT 
          id, project_id, file_path as file, op_type as type,
          line_number as line, column_number as "column", content as text,
          author_id as author, timestamp, version
        FROM operations 
        WHERE project_id = $1 AND version > $2
        ORDER BY version ASC 
        LIMIT $3
      `, [projectId, since, limit]);

      const currentVersion = await this.getProjectVersion(projectId);
      
      return {
        operations: result.rows,
        currentVersion
      };
    } catch (error) {
      console.error('❌ Error getting operations since version:', error);
      return { operations: [], currentVersion: 0 };
    }
  }

  /**
   * Salvar snapshot
   */
  async saveSnapshot(projectId: string, file: string, content: string): Promise<void> {
    try {
      const version = await this.getProjectVersion(projectId);
      const snapshot = {
        id: uuidv4(),
        projectId,
        file,
        content,
        version,
        timestamp: Date.now()
      };

      // Salvar no PostgreSQL
      await this.db.query(`
        INSERT INTO snapshots (id, project_id, file_path, content, version, created_at)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        ON CONFLICT (project_id, file_path) 
        DO UPDATE SET 
          content = EXCLUDED.content,
          version = EXCLUDED.version,
          created_at = CURRENT_TIMESTAMP
      `, [snapshot.id, projectId, file, content, version]);

      // Cache no Redis
      await this.redis.set(
        `snapshot:${projectId}:${file}`, 
        JSON.stringify(snapshot),
        'EX', 7200 // 2 horas
      );
      
      console.log(`✅ Snapshot saved for ${file} in project ${projectId} (v${version})`);
    } catch (error) {
      console.error('❌ Error saving snapshot:', error);
      throw new Error('Failed to save snapshot');
    }
  }

  /**
   * Buscar snapshot
   */
  async getSnapshot(projectId: string, file: string): Promise<any> {
    try {
      // Cache Redis primeiro
      const cached = await this.redis.get(`snapshot:${projectId}:${file}`);
      if (cached) {
        return JSON.parse(cached);
      }

      // PostgreSQL fallback
      const result = await this.db.query(`
        SELECT id, project_id, file_path as file, content, version, created_at
        FROM snapshots 
        WHERE project_id = $1 AND file_path = $2
        ORDER BY created_at DESC 
        LIMIT 1
      `, [projectId, file]);

      if (result.rows.length === 0) {
        return null;
      }

      const snapshot = result.rows[0];
      
      // Atualizar cache
      await this.redis.set(
        `snapshot:${projectId}:${file}`,
        JSON.stringify(snapshot),
        'EX', 7200
      );

      return snapshot;
    } catch (error) {
      console.error('❌ Error getting snapshot:', error);
      return null;
    }
  }

  /**
   * Limpeza de operações (manter apenas no banco)
   */
  async clearOperations(): Promise<void> {
    try {
      // Limpar apenas cache Redis, manter PostgreSQL
      const keys = await this.redis.keys('operations*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      console.log('✅ Redis operation cache cleared');
    } catch (error) {
      console.error('❌ Error clearing operations:', error);
      throw new Error('Failed to clear operations');
    }
  }

  /**
   * Limpeza de projeto específico
   */
  async clearProjectOperations(projectId: string): Promise<void> {
    try {
      const keys = await this.redis.keys(`operations:${projectId}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      await this.redis.del(`version:${projectId}`);
      console.log(`✅ Redis cache cleared for project: ${projectId}`);
    } catch (error) {
      console.error('❌ Error clearing project operations:', error);
      throw new Error('Failed to clear project operations');
    }
  }

  /**
   * Estatísticas do projeto
   */
  async getProjectStats(projectId: string): Promise<any> {
    try {
      const result = await this.db.query(`
        SELECT 
          COUNT(*) as total_operations,
          COUNT(DISTINCT file_path) as total_files,
          COUNT(DISTINCT author_id) as total_authors,
          MAX(version) as current_version,
          MIN(timestamp) as first_operation,
          MAX(timestamp) as last_operation
        FROM operations 
        WHERE project_id = $1
      `, [projectId]);

      const typeStats = await this.db.query(`
        SELECT op_type, COUNT(*) as count
        FROM operations 
        WHERE project_id = $1
        GROUP BY op_type
      `, [projectId]);

      return {
        ...result.rows[0],
        operation_types: typeStats.rows.reduce((acc, row) => {
          acc[row.op_type] = parseInt(row.count);
          return acc;
        }, {})
      };
    } catch (error) {
      console.error('❌ Error getting project stats:', error);
      return {};
    }
  }
}
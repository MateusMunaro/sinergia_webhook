// src/services/project.service.ts
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import { DatabaseService } from '../config/database';
import { Project, User, ProjectUser } from '../types/app';

export class ProjectService {
  private redis: Redis;
  private db: DatabaseService;

  constructor(redis: Redis, db: DatabaseService) {
    this.redis = redis;
    this.db = db;
  }

  /**
   * Criar novo projeto
   */
  async createProject(data: {
    name: string;
    description?: string;
    githubRepo?: string;
    ownerId: string;
  }): Promise<Project> {
    const project: Project = {
      id: uuidv4(),
      name: data.name.trim(),
      description: data.description?.trim(),
      githubRepo: data.githubRepo?.trim(),
      ownerId: data.ownerId,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    try {
      await this.db.transaction(async (client) => {
        // 1. Criar projeto
        await client.query(`
          INSERT INTO projects (id, name, github_repo, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5)
        `, [project.id, project.name, project.githubRepo, project.createdAt, project.updatedAt]);

        // 2. Adicionar owner como usuário do projeto
        await client.query(`
          INSERT INTO project_users (project_id, user_id, role)
          VALUES ($1, $2, 'owner')
        `, [project.id, data.ownerId]);
      });

      // 3. Cache no Redis
      await Promise.all([
        this.redis.set(`project:${project.id}`, JSON.stringify(project), 'EX', 3600),
        this.redis.lpush('projects', project.id),
        this.redis.set(`version:${project.id}`, '0'),
        this.redis.sadd(`project_users:${project.id}`, data.ownerId),
        this.redis.set(
          `project_user:${project.id}:${data.ownerId}`,
          JSON.stringify({ projectId: project.id, userId: data.ownerId, role: 'owner' }),
          'EX', 3600
        )
      ]);

      console.log(`✅ Project created: ${project.name} (${project.id})`);
      return project;
    } catch (error) {
      console.error('❌ Error creating project:', error);
      throw new Error('Failed to create project');
    }
  }

  /**
   * Buscar projeto por ID
   */
  async getProject(projectId: string): Promise<Project | null> {
    try {
      // Cache Redis primeiro
      const cached = await this.redis.get(`project:${projectId}`);
      if (cached) {
        return JSON.parse(cached);
      }

      // PostgreSQL fallback
      const result = await this.db.query(`
        SELECT id, name, github_repo, created_at, updated_at
        FROM projects 
        WHERE id = $1
      `, [projectId]);

      if (result.rows.length === 0) {
        return null;
      }

      const project = {
        id: result.rows[0].id,
        name: result.rows[0].name,
        githubRepo: result.rows[0].github_repo,
        ownerId: '', // Buscar owner separadamente se necessário
        createdAt: result.rows[0].created_at,
        updatedAt: result.rows[0].updated_at
      };

      // Atualizar cache
      await this.redis.set(`project:${projectId}`, JSON.stringify(project), 'EX', 3600);

      return project;
    } catch (error) {
      console.error('❌ Error getting project:', error);
      return null;
    }
  }

  /**
   * Listar projetos do usuário
   */
  async getUserProjects(userId: string, limit: number = 50, offset: number = 0): Promise<Project[]> {
    try {
      const result = await this.db.query(`
        SELECT p.id, p.name, p.github_repo, p.created_at, p.updated_at, pu.role
        FROM projects p
        JOIN project_users pu ON p.id = pu.project_id
        WHERE pu.user_id = $1
        ORDER BY p.updated_at DESC
        LIMIT $2 OFFSET $3
      `, [userId, limit, offset]);

      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        githubRepo: row.github_repo,
        ownerId: row.role === 'owner' ? userId : '',
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      console.error('❌ Error getting user projects:', error);
      return [];
    }
  }

  /**
   * Atualizar projeto
   */
  async updateProject(projectId: string, data: {
    name?: string;
    description?: string;
    githubRepo?: string;
  }): Promise<Project | null> {
    try {
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (data.name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(data.name.trim());
      }
      if (data.githubRepo !== undefined) {
        updates.push(`github_repo = $${paramIndex++}`);
        values.push(data.githubRepo?.trim());
      }

      if (updates.length === 0) {
        return await this.getProject(projectId);
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(projectId);

      const result = await this.db.query(`
        UPDATE projects 
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, name, github_repo, created_at, updated_at
      `, values);

      if (result.rows.length === 0) {
        return null;
      }

      const project = {
        id: result.rows[0].id,
        name: result.rows[0].name,
        githubRepo: result.rows[0].github_repo,
        ownerId: '',
        createdAt: result.rows[0].created_at,
        updatedAt: result.rows[0].updated_at
      };

      // Atualizar cache
      await this.redis.set(`project:${projectId}`, JSON.stringify(project), 'EX', 3600);

      return project;
    } catch (error) {
      console.error('❌ Error updating project:', error);
      throw new Error('Failed to update project');
    }
  }

  /**
   * Deletar projeto
   */
  async deleteProject(projectId: string): Promise<boolean> {
    try {
      await this.db.transaction(async (client) => {
        // Deletar em ordem devido às foreign keys
        await client.query('DELETE FROM snapshots WHERE project_id = $1', [projectId]);
        await client.query('DELETE FROM operations WHERE project_id = $1', [projectId]);
        await client.query('DELETE FROM project_users WHERE project_id = $1', [projectId]);
        await client.query('DELETE FROM projects WHERE id = $1', [projectId]);
      });

      // Limpar cache Redis
      const keys = await this.redis.keys(`*${projectId}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      await this.redis.lrem('projects', 0, projectId);

      console.log(`✅ Project deleted: ${projectId}`);
      return true;
    } catch (error) {
      console.error('❌ Error deleting project:', error);
      return false;
    }
  }

  /**
   * Adicionar usuário ao projeto
   */
  async addUserToProject(projectId: string, userId: string, role: 'owner' | 'write' | 'read'): Promise<boolean> {
    try {
      await this.db.query(`
        INSERT INTO project_users (project_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (project_id, user_id) 
        DO UPDATE SET role = EXCLUDED.role
      `, [projectId, userId, role]);

      // Atualizar cache
      const projectUser = { projectId, userId, role };
      await Promise.all([
        this.redis.sadd(`project_users:${projectId}`, userId),
        this.redis.set(
          `project_user:${projectId}:${userId}`,
          JSON.stringify(projectUser),
          'EX', 3600
        )
      ]);

      return true;
    } catch (error) {
      console.error('❌ Error adding user to project:', error);
      return false;
    }
  }

  /**
   * Remover usuário do projeto
   */
  async removeUserFromProject(projectId: string, userId: string): Promise<boolean> {
    try {
      // Verificar se não é owner
      const result = await this.db.query(`
        SELECT role FROM project_users 
        WHERE project_id = $1 AND user_id = $2
      `, [projectId, userId]);

      if (result.rows.length === 0) {
        return false;
      }

      if (result.rows[0].role === 'owner') {
        throw new Error('Cannot remove project owner');
      }

      await this.db.query(`
        DELETE FROM project_users 
        WHERE project_id = $1 AND user_id = $2
      `, [projectId, userId]);

      // Limpar cache
      await Promise.all([
        this.redis.srem(`project_users:${projectId}`, userId),
        this.redis.del(`project_user:${projectId}:${userId}`)
      ]);

      return true;
    } catch (error) {
      console.error('❌ Error removing user from project:', error);
      return false;
    }
  }

  /**
   * Listar usuários do projeto
   */
  async getProjectUsers(projectId: string): Promise<ProjectUser[]> {
    try {
      const result = await this.db.query(`
        SELECT pu.project_id, pu.user_id, pu.role, u.email, u.github_username
        FROM project_users pu
        JOIN users u ON pu.user_id = u.id
        WHERE pu.project_id = $1
        ORDER BY 
          CASE pu.role 
            WHEN 'owner' THEN 1 
            WHEN 'write' THEN 2 
            WHEN 'read' THEN 3 
          END
      `, [projectId]);

      return result.rows.map(row => ({
        projectId: row.project_id,
        userId: row.user_id,
        role: row.role,
        email: row.email,
        githubUsername: row.github_username
      }));
    } catch (error) {
      console.error('❌ Error getting project users:', error);
      return [];
    }
  }

  /**
   * Verificar permissão do usuário no projeto
   */
  async checkUserPermission(projectId: string, userId: string): Promise<{ hasAccess: boolean; role?: string }> {
    try {
      // Cache primeiro
      const cached = await this.redis.get(`project_user:${projectId}:${userId}`);
      if (cached) {
        const userData = JSON.parse(cached);
        return { hasAccess: true, role: userData.role };
      }

      // PostgreSQL fallback
      const result = await this.db.query(`
        SELECT role FROM project_users 
        WHERE project_id = $1 AND user_id = $2
      `, [projectId, userId]);

      if (result.rows.length === 0) {
        return { hasAccess: false };
      }

      const role = result.rows[0].role;
      
      // Atualizar cache
      await this.redis.set(
        `project_user:${projectId}:${userId}`,
        JSON.stringify({ projectId, userId, role }),
        'EX', 3600
      );

      return { hasAccess: true, role };
    } catch (error) {
      console.error('❌ Error checking user permission:', error);
      return { hasAccess: false };
    }
  }
}
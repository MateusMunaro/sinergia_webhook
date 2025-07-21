import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import { OperationService } from '../services/operation.service';
import { Project, ProjectUser } from '../types/app';

export const createProjectRoutes = (redis: Redis, operationService: OperationService): Router => {
  const router = Router();

  // GET /api/v1/projects - Listar todos os projetos
  router.get('/', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      
      // Buscar IDs dos projetos
      const projectIds = await redis.lrange('projects', offset, offset + limit - 1);
      
      if (projectIds.length === 0) {
        return res.json({
          projects: [],
          count: 0,
          total: 0
        });
      }
      
      // Buscar dados dos projetos
      const projects = await Promise.all(
        projectIds.map(async (id) => {
          const projectData = await redis.get(`project:${id}`);
          return projectData ? JSON.parse(projectData) : null;
        })
      );
      
      const validProjects = projects.filter(p => p !== null);
      const total = await redis.llen('projects');
      
      res.json({
        projects: validProjects,
        count: validProjects.length,
        total,
        limit,
        offset
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to retrieve projects',
        details: error.message
      });
    }
  });

  // POST /api/v1/projects - Criar novo projeto
  router.post('/', async (req, res) => {
    try {
      const { name, description, ownerId, githubRepo } = req.body;

      if (!name || !ownerId) {
        return res.status(400).json({
          error: 'Name and ownerId are required'
        });
      }

      const project: Project = {
        id: uuidv4(),
        name: name.trim(),
        description: description?.trim(),
        githubRepo: githubRepo?.trim(),
        ownerId,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Salvar projeto no Redis
      await redis.set(`project:${project.id}`, JSON.stringify(project));
      await redis.lpush('projects', project.id);
      
      // Adicionar owner como usuário do projeto
      const projectUser: ProjectUser = {
        projectId: project.id,
        userId: ownerId,
        role: 'owner'
      };
      
      await redis.set(
        `project_user:${project.id}:${ownerId}`, 
        JSON.stringify(projectUser)
      );
      await redis.sadd(`project_users:${project.id}`, ownerId);
      
      // Inicializar contadores
      await redis.set(`version:${project.id}`, '0');

      res.status(201).json({
        message: 'Project created successfully',
        project
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to create project',
        details: error.message
      });
    }
  });

  // GET /api/v1/projects/:projectId - Obter projeto específico
  router.get('/:projectId', async (req, res) => {
    try {
      const { projectId } = req.params;

      const projectData = await redis.get(`project:${projectId}`);
      
      if (!projectData) {
        return res.status(404).json({
          error: 'Project not found'
        });
      }

      const project = JSON.parse(projectData);
      const version = await operationService.getProjectVersion(projectId);
      const operationsCount = await redis.llen(`operations:${projectId}`);
      
      // Buscar usuários do projeto
      const userIds = await redis.smembers(`project_users:${projectId}`);
      const users = await Promise.all(
        userIds.map(async (userId) => {
          const userData = await redis.get(`project_user:${projectId}:${userId}`);
          return userData ? JSON.parse(userData) : null;
        })
      );

      res.json({
        project: {
          ...project,
          currentVersion: version,
          operationsCount,
          users: users.filter(u => u !== null)
        }
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to retrieve project',
        details: error.message
      });
    }
  });

  // PUT /api/v1/projects/:projectId - Atualizar projeto
  router.put('/:projectId', async (req, res) => {
    try {
      const { projectId } = req.params;
      const { name, description, githubRepo } = req.body;

      const projectData = await redis.get(`project:${projectId}`);
      
      if (!projectData) {
        return res.status(404).json({
          error: 'Project not found'
        });
      }

      const project = JSON.parse(projectData);
      
      // Atualizar campos
      if (name !== undefined) project.name = name.trim();
      if (description !== undefined) project.description = description?.trim();
      if (githubRepo !== undefined) project.githubRepo = githubRepo?.trim();
      
      project.updatedAt = new Date();

      // Salvar projeto atualizado
      await redis.set(`project:${projectId}`, JSON.stringify(project));

      res.json({
        message: 'Project updated successfully',
        project
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to update project',
        details: error.message
      });
    }
  });

  // DELETE /api/v1/projects/:projectId - Deletar projeto
  router.delete('/:projectId', async (req, res) => {
    try {
      const { projectId } = req.params;

      const projectData = await redis.get(`project:${projectId}`);
      
      if (!projectData) {
        return res.status(404).json({
          error: 'Project not found'
        });
      }

      // Remover projeto da lista principal
      await redis.lrem('projects', 0, projectId);
      
      // Remover dados do projeto
      await redis.del(`project:${projectId}`);
      
      // Remover operações do projeto
      await redis.del(`operations:${projectId}`);
      
      // Remover versão
      await redis.del(`version:${projectId}`);
      
      // Remover usuários do projeto
      const userIds = await redis.smembers(`project_users:${projectId}`);
      for (const userId of userIds) {
        await redis.del(`project_user:${projectId}:${userId}`);
      }
      await redis.del(`project_users:${projectId}`);

      res.json({
        message: 'Project deleted successfully'
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to delete project',
        details: error.message
      });
    }
  });

  // POST /api/v1/projects/:projectId/users - Adicionar usuário ao projeto
  router.post('/:projectId/users', async (req, res) => {
    try {
      const { projectId } = req.params;
      const { userId, role = 'read' } = req.body;

      if (!userId) {
        return res.status(400).json({
          error: 'userId is required'
        });
      }

      if (!['owner', 'write', 'read'].includes(role)) {
        return res.status(400).json({
          error: 'Invalid role. Must be: owner, write, or read'
        });
      }

      // Verificar se projeto existe
      const projectData = await redis.get(`project:${projectId}`);
      if (!projectData) {
        return res.status(404).json({
          error: 'Project not found'
        });
      }

      // Verificar se usuário já está no projeto
      const existingUser = await redis.get(`project_user:${projectId}:${userId}`);
      if (existingUser) {
        return res.status(409).json({
          error: 'User already in project'
        });
      }

      const projectUser: ProjectUser = {
        projectId,
        userId,
        role: role as 'owner' | 'write' | 'read'
      };

      await redis.set(
        `project_user:${projectId}:${userId}`, 
        JSON.stringify(projectUser)
      );
      await redis.sadd(`project_users:${projectId}`, userId);

      res.status(201).json({
        message: 'User added to project successfully',
        projectUser
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to add user to project',
        details: error.message
      });
    }
  });

  // DELETE /api/v1/projects/:projectId/users/:userId - Remover usuário do projeto
  router.delete('/:projectId/users/:userId', async (req, res) => {
    try {
      const { projectId, userId } = req.params;

      // Verificar se usuário está no projeto
      const userData = await redis.get(`project_user:${projectId}:${userId}`);
      if (!userData) {
        return res.status(404).json({
          error: 'User not found in project'
        });
      }

      const user = JSON.parse(userData);
      
      // Não permitir remover o owner
      if (user.role === 'owner') {
        return res.status(403).json({
          error: 'Cannot remove project owner'
        });
      }

      await redis.del(`project_user:${projectId}:${userId}`);
      await redis.srem(`project_users:${projectId}`, userId);

      res.json({
        message: 'User removed from project successfully'
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to remove user from project',
        details: error.message
      });
    }
  });

  // GET /api/v1/projects/:projectId/users - Listar usuários do projeto
  router.get('/:projectId/users', async (req, res) => {
    try {
      const { projectId } = req.params;

      // Verificar se projeto existe
      const projectData = await redis.get(`project:${projectId}`);
      if (!projectData) {
        return res.status(404).json({
          error: 'Project not found'
        });
      }

      const userIds = await redis.smembers(`project_users:${projectId}`);
      const users = await Promise.all(
        userIds.map(async (userId) => {
          const userData = await redis.get(`project_user:${projectId}:${userId}`);
          return userData ? JSON.parse(userData) : null;
        })
      );

      const validUsers = users.filter(u => u !== null);

      res.json({
        projectId,
        users: validUsers,
        count: validUsers.length
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to retrieve project users',
        details: error.message
      });
    }
  });

  // PUT /api/v1/projects/:projectId/users/:userId - Atualizar role do usuário
  router.put('/:projectId/users/:userId', async (req, res) => {
    try {
      const { projectId, userId } = req.params;
      const { role } = req.body;

      if (!role || !['owner', 'write', 'read'].includes(role)) {
        return res.status(400).json({
          error: 'Invalid role. Must be: owner, write, or read'
        });
      }

      // Verificar se usuário está no projeto
      const userData = await redis.get(`project_user:${projectId}:${userId}`);
      if (!userData) {
        return res.status(404).json({
          error: 'User not found in project'
        });
      }

      const user = JSON.parse(userData);
      user.role = role;

      await redis.set(
        `project_user:${projectId}:${userId}`, 
        JSON.stringify(user)
      );

      res.json({
        message: 'User role updated successfully',
        projectUser: user
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to update user role',
        details: error.message
      });
    }
  });

  // GET /api/v1/projects/:projectId/files - Listar arquivos do projeto
  router.get('/:projectId/files', async (req, res) => {
    try {
      const { projectId } = req.params;

      // Buscar todas as operações do projeto para extrair lista de arquivos
      const operations = await operationService.getOperationsByProject(projectId, 1000);
      
      // Extrair arquivos únicos
      const filesSet = new Set<string>();
      operations.forEach(op => filesSet.add(op.file));
      
      const files = Array.from(filesSet).map(file => ({
        path: file,
        operations_count: operations.filter(op => op.file === file).length,
        last_modified: Math.max(
          ...operations
            .filter(op => op.file === file)
            .map(op => op.timestamp)
        )
      }));

      res.json({
        projectId,
        files: files.sort((a, b) => b.last_modified - a.last_modified),
        count: files.length
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to retrieve project files',
        details: error.message
      });
    }
  });

  // GET /api/v1/projects/:projectId/stats - Estatísticas do projeto
  router.get('/:projectId/stats', async (req, res) => {
    try {
      const { projectId } = req.params;

      // Verificar se projeto existe
      const projectData = await redis.get(`project:${projectId}`);
      if (!projectData) {
        return res.status(404).json({
          error: 'Project not found'
        });
      }

      const project = JSON.parse(projectData);
      const operations = await operationService.getOperationsByProject(projectId, 10000);
      const version = await operationService.getProjectVersion(projectId);
      const usersCount = await redis.scard(`project_users:${projectId}`);

      // Estatísticas por tipo de operação
      const operationTypes = operations.reduce((acc, op) => {
        acc[op.type] = (acc[op.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Estatísticas por arquivo
      const fileStats = operations.reduce((acc, op) => {
        if (!acc[op.file]) {
          acc[op.file] = { count: 0, types: {} };
        }
        acc[op.file].count++;
        acc[op.file].types[op.type] = (acc[op.file].types[op.type] || 0) + 1;
        return acc;
      }, {} as Record<string, any>);

      // Estatísticas por autor
      const authorStats = operations.reduce((acc, op) => {
        const author = op.author || 'anonymous';
        acc[author] = (acc[author] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Atividade ao longo do tempo (últimos 7 dias)
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;
      const activityByDay = [];
      
      for (let i = 6; i >= 0; i--) {
        const dayStart = now - (i * oneDay);
        const dayEnd = dayStart + oneDay;
        const dayOperations = operations.filter(op => 
          op.timestamp >= dayStart && op.timestamp < dayEnd
        ).length;
        
        activityByDay.push({
          date: new Date(dayStart).toISOString().split('T')[0],
          operations: dayOperations
        });
      }

      res.json({
        projectId,
        project: {
          name: project.name,
          created_at: project.createdAt,
          updated_at: project.updatedAt
        },
        stats: {
          current_version: version,
          total_operations: operations.length,
          total_users: usersCount,
          total_files: Object.keys(fileStats).length,
          operation_types: operationTypes,
          file_stats: fileStats,
          author_stats: authorStats,
          activity_by_day: activityByDay
        }
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to retrieve project stats',
        details: error.message
      });
    }
  });

  return router;
};
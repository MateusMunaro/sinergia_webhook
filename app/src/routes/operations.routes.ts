import { Router } from 'express';
import { OperationService } from '../services/operation.service';

export const createOperationRoutes = (operationService: OperationService): Router => {
  const router = Router();

  // GET /api/v1/operations - Listar todas as operações
  router.get('/', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const operations = await operationService.getAllOperations(limit);
      
      res.json({
        operations,
        count: operations.length,
        limit
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to retrieve operations',
        details: error.message
      });
    }
  });

  // GET /api/v1/operations/project/:projectId - Operações por projeto
  router.get('/project/:projectId', async (req, res) => {
    try {
      const { projectId } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;
      
      const operations = await operationService.getOperationsByProject(projectId, limit);
      const version = await operationService.getProjectVersion(projectId);
      
      res.json({
        projectId,
        operations,
        count: operations.length,
        currentVersion: version,
        limit
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to retrieve project operations',
        details: error.message
      });
    }
  });

  // GET /api/v1/operations/project/:projectId/file/:file - Operações por arquivo
  router.get('/project/:projectId/file/:file', async (req, res) => {
    try {
      const { projectId, file } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;
      
      // Decodificar nome do arquivo
      const decodedFile = decodeURIComponent(file);
      
      const operations = await operationService.getOperationsByFile(projectId, decodedFile, limit);
      
      res.json({
        projectId,
        file: decodedFile,
        operations,
        count: operations.length,
        limit
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to retrieve file operations',
        details: error.message
      });
    }
  });

  // GET /api/v1/operations/project/:projectId/sync - Sincronização
  router.get('/project/:projectId/sync', async (req, res) => {
    try {
      const { projectId } = req.params;
      const since = parseInt(req.query.since as string) || 0;
      const limit = parseInt(req.query.limit as string) || 100;
      
      const result = await operationService.getOperationsSinceVersion(projectId, since, limit);
      
      res.json(result);
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to sync operations',
        details: error.message
      });
    }
  });

  // POST /api/v1/operations - Criar nova operação (via REST)
  router.post('/', async (req, res) => {
    try {
      const operationData = req.body;
      
      // Validação básica
      if (!operationData.type || !operationData.file || !operationData.projectId) {
        return res.status(400).json({
          error: 'Missing required fields: type, file, projectId'
        });
      }
      
      const operation = await operationService.saveOperation(operationData);
      
      res.status(201).json({
        message: 'Operation created successfully',
        operation
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to create operation',
        details: error.message
      });
    }
  });

  // DELETE /api/v1/operations - Limpar todas as operações
  router.delete('/', async (req, res) => {
    try {
      await operationService.clearOperations();
      
      res.json({
        message: 'All operations cleared successfully'
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to clear operations',
        details: error.message
      });
    }
  });

  // DELETE /api/v1/operations/project/:projectId - Limpar operações do projeto
  router.delete('/project/:projectId', async (req, res) => {
    try {
      const { projectId } = req.params;
      await operationService.clearProjectOperations(projectId);
      
      res.json({
        message: `Operations cleared for project ${projectId}`
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to clear project operations',
        details: error.message
      });
    }
  });

  // GET/POST /api/v1/operations/project/:projectId/snapshot/:file - Snapshots
  router.get('/project/:projectId/snapshot/:file', async (req, res) => {
    try {
      const { projectId, file } = req.params;
      const decodedFile = decodeURIComponent(file);
      
      const snapshot = await operationService.getSnapshot(projectId, decodedFile);
      
      if (!snapshot) {
        return res.status(404).json({
          error: 'Snapshot not found'
        });
      }
      
      res.json({ snapshot });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to retrieve snapshot',
        details: error.message
      });
    }
  });

  router.post('/project/:projectId/snapshot/:file', async (req, res) => {
    try {
      const { projectId, file } = req.params;
      const { content } = req.body;
      const decodedFile = decodeURIComponent(file);
      
      if (!content) {
        return res.status(400).json({
          error: 'Content is required'
        });
      }
      
      await operationService.saveSnapshot(projectId, decodedFile, content);
      
      res.json({
        message: 'Snapshot saved successfully'
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to save snapshot',
        details: error.message
      });
    }
  });

  return router;
};
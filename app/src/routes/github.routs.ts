import { Router } from 'express';
import { GitHubService } from '../services/github.service';

export const createGitHubRoutes = (githubService: GitHubService): Router => {
  const router = Router();

  // POST /api/v1/github/repositories - Criar repositório
  router.post('/repositories', async (req, res) => {
    try {
      const { name, description, private: isPrivate = false } = req.body;

      if (!name) {
        return res.status(400).json({
          error: 'Repository name is required'
        });
      }

      const result = await githubService.createRepository(name, description, isPrivate);

      if (result.success) {
        res.status(201).json({
          message: 'Repository created successfully',
          repository: result.data,
          urls: {
            clone: result.clone_url,
            web: result.html_url
          }
        });
      } else {
        res.status(400).json({
          error: result.error
        });
      }
    } catch (error: any) {
      res.status(500).json({
        error: 'Internal server error',
        details: error.message
      });
    }
  });

  // GET /api/v1/github/repositories/:repoName - Informações do repositório
  router.get('/repositories/:repoName', async (req, res) => {
    try {
      const { repoName } = req.params;

      const result = await githubService.getRepositoryInfo(repoName);

      if (result.success) {
        res.json({
          repository: result.data
        });
      } else {
        res.status(404).json({
          error: result.error
        });
      }
    } catch (error: any) {
      res.status(500).json({
        error: 'Internal server error',
        details: error.message
      });
    }
  });

  // POST /api/v1/github/repositories/:repoName/commit - Fazer commit
  router.post('/repositories/:repoName/commit', async (req, res) => {
    try {
      const { repoName } = req.params;
      const { message, files, autoCommit = false } = req.body;

      let result;

      if (autoCommit) {
        // Auto-commit das operações do Redis
        result = await githubService.autoCommitOperations(repoName);
      } else {
        // Commit customizado
        if (!message || !files) {
          return res.status(400).json({
            error: 'Message and files are required for custom commit'
          });
        }

        result = await githubService.commitChanges(repoName, { message, files });
      }

      if (result.success) {
        res.json({
          message: autoCommit ? 'Auto-commit completed' : 'Custom commit created',
          commit_sha: result.commit_sha,
          commit_url: result.commit_url,
          operations_count: result.operations_count || 0
        });
      } else {
        res.status(400).json({
          error: result.error
        });
      }
    } catch (error: any) {
      res.status(500).json({
        error: 'Internal server error',
        details: error.message
      });
    }
  });

  // GET /api/v1/github/operations - Operações pendentes para commit
  router.get('/operations', async (req, res) => {
    try {
      const operations = await githubService.getOperationsFromRedis();

      res.json({
        operations,
        count: operations.length,
        ready_for_commit: operations.length > 0
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Internal server error',
        details: error.message
      });
    }
  });

  // POST /api/v1/github/repositories/:repoName/sync - Sincronizar com GitHub
  router.post('/repositories/:repoName/sync', async (req, res) => {
    try {
      const { repoName } = req.params;
      const { branch = 'main' } = req.body;

      // TODO: Implementar sincronização do GitHub para o sistema
      // Isso incluiria buscar commits do GitHub e aplicar no sistema local

      res.status(501).json({
        error: 'GitHub to local sync not implemented yet',
        todo: 'Fetch GitHub commits and apply to local system'
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Internal server error',
        details: error.message
      });
    }
  });

  // GET /api/v1/github/repositories/:repoName/commits - Listar commits
  router.get('/repositories/:repoName/commits', async (req, res) => {
    try {
      const { repoName } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;

      // TODO: Implementar listagem de commits do GitHub
      res.status(501).json({
        error: 'GitHub commits listing not implemented yet',
        todo: 'Fetch commits from GitHub API'
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Internal server error',
        details: error.message
      });
    }
  });

  // DELETE /api/v1/github/repositories/:repoName - Deletar repositório
  router.delete('/repositories/:repoName', async (req, res) => {
    try {
      const { repoName } = req.params;

      // TODO: Implementar deleção de repositório
      res.status(501).json({
        error: 'Repository deletion not implemented yet',
        warning: 'This is a destructive operation'
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Internal server error',
        details: error.message
      });
    }
  });

  return router;
};
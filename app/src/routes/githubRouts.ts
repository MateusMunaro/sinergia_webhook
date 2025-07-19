import { Router } from 'express';
import { GitHubController } from '../controllers/githubController';
import Redis from 'ioredis';

export const createGitHubRoutes = (redis: Redis): Router => {
  const router = Router();
  const githubController = new GitHubController(redis);

  // Criar repositório
  router.post('/repositories', githubController.createRepository);

  // Obter informações do repositório
  router.get('/repositories/:repoName', githubController.getRepository);

  // Fazer commit (auto ou customizado)
  router.post('/repositories/:repoName/commit', githubController.commitOperations);

  // Obter operações do Redis
  router.get('/operations', githubController.getOperations);

  return router;
};
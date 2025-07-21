import { Express } from 'express';
import { AppDependencies } from '../types/app';
import { createOperationRoutes } from './operations.routes';
import { createGitHubRoutes } from './github.routs';
import { createProjectRoutes } from './projects.routes';

export const setupRoutes = (app: Express, dependencies: AppDependencies) => {
  const { redis, operationService, githubService } = dependencies;

  // API versioning
  const apiV1 = '/api/v1';

  // Rotas de operações
  app.use(`${apiV1}/operations`, createOperationRoutes(operationService));
  
  // Rotas do GitHub
  app.use(`${apiV1}/github`, createGitHubRoutes(githubService));
  
  // Rotas de projetos
  app.use(`${apiV1}/projects`, createProjectRoutes(redis, operationService));

  // Documentação da API
  app.get(`${apiV1}`, (req, res) => {
    res.json({
      name: 'MyVC API',
      version: '1.0.0',
      endpoints: {
        health: '/health',
        operations: `${apiV1}/operations`,
        github: `${apiV1}/github`,
        projects: `${apiV1}/projects`
      },
      websocket: {
        url: '/socket.io',
        events: [
          'join-project',
          'leave-project', 
          'operation',
          'sync-request'
        ]
      }
    });
  });
};
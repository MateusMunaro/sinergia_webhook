import { Express } from 'express';
import { AppDependencies } from '../types/app';
import { createOperationRoutes } from './operations.routes';
import { createGitHubRoutes } from './github.routs';
import { createProjectRoutes } from './projects.routes';
import { createLoginRoutes } from './login.routs';
import { createUserRoutes } from './user.routes';

export const setupRoutes = (app: Express, dependencies: AppDependencies) => {
  const { redis, operationService, githubService, projectService, userService } = dependencies;

  // API versioning
  const apiV1 = '/api/v1';

  // Rotas de operações
  app.use(`${apiV1}/operations`, createOperationRoutes(operationService));
  
  // Rotas do GitHub
  app.use(`${apiV1}/github`, createGitHubRoutes(githubService));
  
  // Rotas de projetos
  app.use(`${apiV1}/projects`, createProjectRoutes(redis, operationService, projectService));

  // Rotas de usuários
  app.use(`${apiV1}/users`, createUserRoutes(userService));

  
  app.use(`${apiV1}/login`, createLoginRoutes(dependencies));

  // Documentação da API
  app.get(`${apiV1}`, (req, res) => {
    res.json({
      name: 'MyVC API',
      version: '1.0.0',
      endpoints: {
        health: '/health',
        operations: `${apiV1}/operations`,
        github: `${apiV1}/github`,
        projects: `${apiV1}/projects`,
        users: `${apiV1}/users`,
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
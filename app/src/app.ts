import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { setupRoutes } from './routes';
import { AppDependencies } from './types/app';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';

export const createApp = (dependencies: AppDependencies) => {
  const app = express();
  
  // Middleware de segurança
  app.use(helmet());
  
  // CORS
  app.use(cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true
  }));
  
  // Parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  
  // Logging
  app.use(requestLogger);
  
  // Health check básico
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV
    });
  });
  
  // Configurar todas as rotas
  setupRoutes(app, dependencies);
  
  // Error handling
  app.use(errorHandler);
  
  return app;
};
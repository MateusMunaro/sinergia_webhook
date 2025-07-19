import express from 'express';
import cors from 'cors';
import { createRoutes } from './routes/routes';
import Redis from 'ioredis';

export const createApp = (redis: Redis) => {
  const app = express();
  
  app.use(cors());
  app.use(express.json());
  
  // Registrar rotas
  app.use('/', createRoutes(redis));
  
  return app;
};
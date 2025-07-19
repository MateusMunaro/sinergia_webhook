import { Router } from 'express';
import { OperationsController } from '../controllers/operationsController';
import Redis from 'ioredis';

export const createRoutes = (redis: Redis): Router => {
  const router = Router();
  const operationsController = new OperationsController(redis);

  router.get('/operations', operationsController.getOperations);
  router.get('/health', operationsController.healthCheck);

  return router;
};
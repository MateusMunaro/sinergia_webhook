import { Request, Response } from 'express';
import Redis from 'ioredis';

export class OperationsController {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  getOperations = async (req: Request, res: Response) => {
    try {
      const operations = await this.redis.lrange('operations', 0, -1);
      res.json(operations.map(op => JSON.parse(op)));
    } catch (error) {
      console.error('Error retrieving operations from Redis:', error);
      res.status(500).json({ error: 'Failed to retrieve operations' });
    }
  };

  healthCheck = async (req: Request, res: Response) => {
    try {
      await this.redis.ping();
      res.json({ status: 'healthy', redis: 'connected' });
    } catch (error) {
      res.status(503).json({ status: 'unhealthy', redis: 'disconnected' });
    }
  };
}
import Redis from 'ioredis';

export const createRedisConnection = () => {
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: 10000,
    commandTimeout: 5000,
  });

  redis.on('connect', () => {
    console.log('✅ Connected to Redis');
  });

  redis.on('ready', () => {
    console.log('✅ Redis is ready');
  });

  redis.on('error', (error) => {
    console.error('❌ Redis connection error:', error.message);
  });

  redis.on('close', () => {
    console.log('⚠️ Redis connection closed');
  });

  redis.on('reconnecting', () => {
    console.log('🔄 Reconnecting to Redis...');
  });

  return redis;
};
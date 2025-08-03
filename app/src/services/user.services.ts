import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import { DatabaseService } from '../config/database';
import { Project, User, ProjectUser } from '../types/app';

export class UserService {
  private redis: Redis;
  private db: DatabaseService;

  constructor(redis: Redis, db: DatabaseService) {
    this.redis = redis;
    this.db = db;
  }
  /**
   * Criar novo usuario
   */
  async createUser(data: { name: string, email: string, githubUsername: string, password?: string }): Promise<User> {
    const { name, email, githubUsername, password } = data;

    if (!name || !email) {
      throw new Error('Name and email are required');
    }

    const existingUser = await this.db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      throw new Error('User with this email already exists');
    }

    const user: User = {
      id: uuidv4(),
      name,
      githubUsername,
      email,
      password,
      createdAt: new Date()
    };

    try {
      await this.db.transaction(async (client) => {
        await client.query(
          `INSERT INTO users (id, name, email, github_username, password, created_at, isactive, updatedat) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            user.id,
            user.name,
            user.email,
            user.githubUsername,
            password || null, // password pode ser null se não fornecida
            user.createdAt,
            true, // isactive = true por padrão
            user.createdAt // updatedat = created_at inicialmente
          ]
        );
      });

      // Cache no Redis
      await this.redis.set(`user:${user.id}`, JSON.stringify(user));
      await this.redis.sadd('users', user.id);

      return user;
    } catch (error) {
      throw new Error(`Failed to create user: ${error.message}`);
    }
  }
}
import { Request, Response } from 'express';
import { GitHubService } from '../services/github.service';
import Redis from 'ioredis';

export class GitHubController {
  private githubService: GitHubService;

  constructor(redis: Redis) {
    const githubConfig = {
      token: process.env.GITHUB_TOKEN!,
      owner: process.env.GITHUB_OWNER!,
    };
    
    this.githubService = new GitHubService(githubConfig, redis);
  }

  createRepository = async (req: Request, res: Response) => {
    try {
      const { name, description, private: isPrivate } = req.body;

      if (!name) {
        return res.status(400).json({ 
          error: 'Repository name is required' 
        });
      }

      const result = await this.githubService.createRepository(
        name, 
        description, 
        isPrivate || false
      );

      if (result.success) {
        res.status(201).json({
          message: 'Repository created successfully',
          repository: result.data,
        });
      } else {
        res.status(400).json({
          error: result.error,
        });
      }
    } catch (error: any) {
      res.status(500).json({
        error: 'Internal server error',
        details: error.message,
      });
    }
  };

  getRepository = async (req: Request, res: Response) => {
    try {
      const { repoName } = req.params;

      if (!repoName) {
        return res.status(400).json({ 
          error: 'Repository name is required' 
        });
      }

      const result = await this.githubService.getRepositoryInfo(repoName);

      if (result.success) {
        res.json({
          repository: result.data,
        });
      } else {
        res.status(404).json({
          error: result.error,
        });
      }
    } catch (error: any) {
      res.status(500).json({
        error: 'Internal server error',
        details: error.message,
      });
    }
  };

  commitOperations = async (req: Request, res: Response) => {
    try {
      const { repoName } = req.params;
      const { message, files } = req.body;

      if (!repoName) {
        return res.status(400).json({ 
          error: 'Repository name is required' 
        });
      }

      let commitData;
      
      if (files && message) {
        // Commit customizado
        commitData = { message, files };
        const result = await this.githubService.commitChanges(repoName, commitData);
        
        if (result.success) {
          res.json({
            message: 'Custom commit created successfully',
            commit_sha: result.commit_sha,
            commit_url: result.commit_url,
          });
        } else {
          res.status(400).json({ error: result.error });
        }
      } else {
        // Auto-commit das operações do Redis
        const result = await this.githubService.autoCommitOperations(repoName);
        
        if (result.success) {
          res.json({
            message: 'Auto-commit completed successfully',
            ...result,
          });
        } else {
          res.status(400).json({ error: result.error });
        }
      }
    } catch (error: any) {
      res.status(500).json({
        error: 'Internal server error',
        details: error.message,
      });
    }
  };

  getOperations = async (req: Request, res: Response) => {
    try {
      const operations = await this.githubService.getOperationsFromRedis();
      
      res.json({
        operations,
        count: operations.length,
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Internal server error',
        details: error.message,
      });
    }
  };
}
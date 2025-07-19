import { Octokit } from '@octokit/rest';
import Redis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

export interface GitHubConfig {
  token: string;
  owner: string;
  repo?: string;
}

export interface CommitData {
  message: string;
  files: Array<{
    path: string;
    content: string;
  }>;
}

export class GitHubService {
  private octokit: Octokit;
  private owner: string;
  private redis: Redis;

  constructor(config: GitHubConfig, redis: Redis) {
    this.octokit = new Octokit({
      auth: config.token,
    });
    this.owner = config.owner;
    this.redis = redis;
  }

  async createRepository(repoName: string, description?: string, isPrivate: boolean = false) {
    try {
      const response = await this.octokit.rest.repos.createForAuthenticatedUser({
        name: repoName,
        description: description || `Repository created via Sinergia Webhook - ${new Date().toISOString()}`,
        private: isPrivate,
        auto_init: true,
        license_template: 'mit',
      });

      console.log(`✅ Repository '${repoName}' created successfully`);
      return {
        success: true,
        data: response.data,
        clone_url: response.data.clone_url,
        html_url: response.data.html_url,
      };
    } catch (error: any) {
      console.error('❌ Error creating repository:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async getRepositoryInfo(repoName: string) {
    try {
      const response = await this.octokit.rest.repos.get({
        owner: this.owner,
        repo: repoName,
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async commitChanges(repoName: string, commitData: CommitData) {
    try {
      // Obter referência da branch principal
      const { data: ref } = await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: repoName,
        ref: 'heads/main',
      });

      const currentCommitSha = ref.object.sha;

      // Obter a árvore atual
      const { data: currentCommit } = await this.octokit.rest.git.getCommit({
        owner: this.owner,
        repo: repoName,
        commit_sha: currentCommitSha,
      });

      // Criar blobs para os arquivos
      const fileBlobs = await Promise.all(
        commitData.files.map(async (file) => {
          const { data: blob } = await this.octokit.rest.git.createBlob({
            owner: this.owner,
            repo: repoName,
            content: Buffer.from(file.content).toString('base64'),
            encoding: 'base64',
          });

          return {
            path: file.path,
            mode: '100644' as const,
            type: 'blob' as const,
            sha: blob.sha,
          };
        })
      );

      // Criar nova árvore
      const { data: newTree } = await this.octokit.rest.git.createTree({
        owner: this.owner,
        repo: repoName,
        base_tree: currentCommit.tree.sha,
        tree: fileBlobs,
      });

      // Criar novo commit
      const { data: newCommit } = await this.octokit.rest.git.createCommit({
        owner: this.owner,
        repo: repoName,
        message: commitData.message,
        tree: newTree.sha,
        parents: [currentCommitSha],
      });

      // Atualizar referência da branch
      await this.octokit.rest.git.updateRef({
        owner: this.owner,
        repo: repoName,
        ref: 'heads/main',
        sha: newCommit.sha,
      });

      console.log(`✅ Commit created successfully: ${newCommit.sha}`);
      return {
        success: true,
        commit_sha: newCommit.sha,
        commit_url: newCommit.html_url,
      };
    } catch (error: any) {
      console.error('❌ Error creating commit:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async getOperationsFromRedis(): Promise<any[]> {
    try {
      const operations = await this.redis.lrange('operations', 0, -1);
      return operations.map(op => JSON.parse(op));
    } catch (error: any) {
      console.error('❌ Error getting operations from Redis:', error.message);
      return [];
    }
  }

  async clearOperationsFromRedis(): Promise<void> {
    try {
      await this.redis.del('operations');
      console.log('✅ Operations cleared from Redis');
    } catch (error: any) {
      console.error('❌ Error clearing operations from Redis:', error.message);
    }
  }

  async autoCommitOperations(repoName: string): Promise<any> {
    try {
      const operations = await this.getOperationsFromRedis();
      
      if (operations.length === 0) {
        console.log('ℹ️ No operations to commit');
        return { success: true, message: 'No operations to commit' };
      }

      // Preparar dados para commit
      const timestamp = new Date().toISOString();
      const operationsContent = JSON.stringify(operations, null, 2);
      
      const commitData: CommitData = {
        message: `Auto-commit: ${operations.length} operations - ${timestamp}`,
        files: [
          {
            path: `operations/operations-${Date.now()}.json`,
            content: operationsContent,
          },
          {
            path: 'operations/latest.json',
            content: operationsContent,
          },
        ],
      };

      // Fazer commit
      const result = await this.commitChanges(repoName, commitData);
      
      if (result.success) {
        // Limpar operações do Redis após commit bem-sucedido
        await this.clearOperationsFromRedis();
      }

      return result;
    } catch (error: any) {
      console.error('❌ Error in auto-commit:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
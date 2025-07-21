import { Octokit } from '@octokit/rest';
import Redis from 'ioredis';
import { GitHubConfig, CommitData } from '../types/app';

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
        description: description || `Repository created via MyVC - ${new Date().toISOString()}`,
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
      
      let errorMessage = error.message;
      if (error.status === 422 && error.message.includes('already exists')) {
        errorMessage = 'Repository already exists';
      }
      
      return {
        success: false,
        error: errorMessage,
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
        data: {
          name: response.data.name,
          full_name: response.data.full_name,
          description: response.data.description,
          private: response.data.private,
          html_url: response.data.html_url,
          clone_url: response.data.clone_url,
          created_at: response.data.created_at,
          updated_at: response.data.updated_at,
          default_branch: response.data.default_branch,
          size: response.data.size,
          language: response.data.language,
          topics: response.data.topics
        },
      };
    } catch (error: any) {
      console.error('❌ Error getting repository info:', error.message);
      
      let errorMessage = error.message;
      if (error.status === 404) {
        errorMessage = 'Repository not found';
      }
      
      return {
        success: false,
        error: errorMessage,
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
        files_committed: commitData.files.length
      };
    } catch (error: any) {
      console.error('❌ Error creating commit:', error.message);
      
      let errorMessage = error.message;
      if (error.status === 404) {
        errorMessage = 'Repository not found or branch does not exist';
      } else if (error.status === 409) {
        errorMessage = 'Conflict occurred during commit';
      }
      
      return {
        success: false,
        error: errorMessage,
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

  async clearOperationsFromRedis(): Promise<number> {
    try {
      const count = await this.redis.llen('operations');
      await this.redis.del('operations');
      console.log(`✅ ${count} operations cleared from Redis`);
      return count;
    } catch (error: any) {
      console.error('❌ Error clearing operations from Redis:', error.message);
      return 0;
    }
  }

  async autoCommitOperations(repoName: string): Promise<any> {
    try {
      const operations = await this.getOperationsFromRedis();
      
      if (operations.length === 0) {
        console.log('ℹ️ No operations to commit');
        return { 
          success: true, 
          message: 'No operations to commit',
          operations_count: 0
        };
      }

      // Preparar dados para commit
      const timestamp = new Date().toISOString();
      const operationsContent = JSON.stringify(operations, null, 2);
      
      // Agrupar operações por arquivo para melhor organização
      const fileGroups = new Map<string, any[]>();
      operations.forEach(op => {
        if (!fileGroups.has(op.file)) {
          fileGroups.set(op.file, []);
        }
        fileGroups.get(op.file)!.push(op);
      });
      
      const commitData: CommitData = {
        message: `feat: Auto-commit ${operations.length} operations\n\nFiles modified: ${Array.from(fileGroups.keys()).join(', ')}\nTimestamp: ${timestamp}`,
        files: [
          {
            path: `operations/batch-${Date.now()}.json`,
            content: operationsContent,
          },
          {
            path: 'operations/latest.json',
            content: operationsContent,
          },
          // Criar arquivo de resumo
          {
            path: 'operations/summary.md',
            content: this.generateOperationsSummary(operations, fileGroups)
          }
        ],
      };

      // Fazer commit
      const result = await this.commitChanges(repoName, commitData);
      
      if (result.success) {
        // Limpar operações do Redis após commit bem-sucedido
        const clearedCount = await this.clearOperationsFromRedis();
        
        return {
          ...result,
          operations_count: clearedCount,
          message: 'Auto-commit completed successfully'
        };
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

  private generateOperationsSummary(operations: any[], fileGroups: Map<string, any[]>): string {
    const timestamp = new Date().toISOString();
    
    let summary = `# Operations Summary\n\n`;
    summary += `**Generated:** ${timestamp}\n`;
    summary += `**Total Operations:** ${operations.length}\n`;
    summary += `**Files Modified:** ${fileGroups.size}\n\n`;
    
    summary += `## Files Overview\n\n`;
    
    for (const [file, ops] of fileGroups.entries()) {
      const typeCounts = ops.reduce((acc, op) => {
        acc[op.type] = (acc[op.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      summary += `### ${file}\n`;
      summary += `- **Operations:** ${ops.length}\n`;
      
      for (const [type, count] of Object.entries(typeCounts)) {
        summary += `  - ${type}: ${count}\n`;
      }
      
      summary += `\n`;
    }
    
    summary += `## Operation Timeline\n\n`;
    
    const sortedOps = operations.sort((a, b) => a.timestamp - b.timestamp);
    
    sortedOps.slice(0, 10).forEach(op => {
      const date = new Date(op.timestamp).toISOString();
      summary += `- **${date}**: ${op.type} on ${op.file} by ${op.author || 'anonymous'}\n`;
    });
    
    if (operations.length > 10) {
      summary += `\n_... and ${operations.length - 10} more operations_\n`;
    }
    
    return summary;
  }

  // Método para verificar se o repositório existe
  async repositoryExists(repoName: string): Promise<boolean> {
    try {
      await this.octokit.rest.repos.get({
        owner: this.owner,
        repo: repoName,
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  // Método para listar repositórios do usuário
  async listRepositories(): Promise<any> {
    try {
      const response = await this.octokit.rest.repos.listForAuthenticatedUser({
        sort: 'updated',
        direction: 'desc',
        per_page: 100
      });

      return {
        success: true,
        repositories: response.data.map(repo => ({
          name: repo.name,
          full_name: repo.full_name,
          description: repo.description,
          private: repo.private,
          html_url: repo.html_url,
          updated_at: repo.updated_at
        }))
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}
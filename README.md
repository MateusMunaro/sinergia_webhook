# MyVC Backend

Sistema de versionamento colaborativo em tempo real com integração GitHub.

## 🚀 Características

- **Colaboração em Tempo Real**: WebSocket para sincronização instantânea
- **Versionamento Local**: Sistema similar ao Git para controle de versões
- **Integração GitHub**: Sincronização automática com repositórios GitHub
- **Escalabilidade**: Arquitetura preparada para múltiplas instâncias
- **API REST**: Interface completa para operações CRUD

## 🏗️ Arquitetura

```
┌─────────────────┐      ┌─────────────────┐
│   Cliente C     │      │   Frontend      │
│   (Native)      │      │   (Web/Mobile)  │
└────────┬────────┘      └────────┬────────┘
         │ WebSocket/REST         │ Socket.IO
         └────────────────────────┼───────────┐
                                  │           │
                    ┌─────────────▼───────────▼─┐
                    │      Load Balancer        │
                    │        (Nginx)            │
                    └─────────────┬─────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
┌────────▼────────┐     ┌────────▼────────┐     ┌────────▼────────┐
│   Node.js       │     │   Node.js       │     │   Node.js       │
│   Server 1      │     │   Server 2      │     │   Server N      │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
┌────────▼────────┐     ┌────────▼────────┐     ┌────────▼────────┐
│   PostgreSQL    │     │      Redis       │     │   GitHub API   │
│   (Metadata)    │     │  (Cache/PubSub)  │     │ (Versionamento)│
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## 📦 Instalação

### Pré-requisitos
- Node.js 18+
- Docker & Docker Compose
- GitHub Personal Access Token

### Setup Rápido

1. **Clone o repositório**
   ```bash
   git clone <repository-url>
   cd myvc-backend
   ```

2. **Configure as variáveis de ambiente**
   ```bash
   cp .env.example .env
   # Edite o .env com suas configurações
   ```

3. **Instale as dependências**
   ```bash
   npm install
   ```

4. **Inicie os serviços**
   ```bash
   # Desenvolvimento
   docker-compose up -d redis postgres
   npm run dev
   
   # Ou tudo com Docker
   docker-compose up
   ```

### Configuração do GitHub

1. Crie um Personal Access Token em: https://github.com/settings/tokens
2. Permissões necessárias: `repo`, `user`
3. Configure no `.env`:
   ```env
   GITHUB_TOKEN=ghp_your_token_here
   GITHUB_OWNER=your_github_username
   ```

## 🛠️ Uso

### API REST

#### Operações
```bash
# Listar operações
GET /api/v1/operations

# Operações por projeto
GET /api/v1/operations/project/:projectId

# Criar operação
POST /api/v1/operations
{
  "type": "insert",
  "file": "main.c",
  "line": 10,
  "column": 5,
  "text": "printf(\"Hello\");",
  "author": "user123",
  "projectId": "proj-123"
}
```

#### GitHub Integration
```bash
# Criar repositório
POST /api/v1/github/repositories

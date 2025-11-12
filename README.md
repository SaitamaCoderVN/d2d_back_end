# D2D Backend API

NestJS-based backend service for managing Solana program deployments from devnet to mainnet.

## Features

- RESTful API for deployment management
- Automated Solana program dumping from devnet
- Mainnet deployment orchestration
- Supabase integration for deployment tracking
- Solana wallet generation and management
- Swagger API documentation

## Installation

```bash
npm install
# or
yarn install
```

## Configuration

Create a `.env` file in the backend directory:

```env
# Server Configuration
PORT=
NODE_ENV=

# backend/.env
SOLANA_ENV=

# SUPABASE DATABASE
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# Solana Configuration
SOLANA_DEVNET_RPC=
SOLANA_MAINNET_RPC=
SOLANA_CLI_PATH=

# Admin Configuration
ADMIN_WALLET_PATH=

# ENCRYPTION (Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ENCRYPTION_KEY=

# CORS
CORS_ORIGIN=

# D2D PROGRAM
D2D_PROGRAM_ID=

SERVICE_FEE_PERCENTAGE=
MONTHLY_FEE_LAMPORTS=
```

## Running the App

```bash
# Development
pnpm run start:dev

# Production mode
pnpm run build
```

## API Endpoints

### Create Deployment

```http
POST /api/deployments
Content-Type: application/json

{
  "userWalletAddress": "Hs4Hxe7k43p4YJqqyRnhoXboBB7MCzN8QpqW9NXuSrF8",
  "devnetProgramId": "5aai4VhRLDCFP2WSHUbGsiSuZxkWzQahhsRkqdfF2jRh"
}
```

### Get Deployments by User

```http
GET /api/deployments?userWalletAddress=Hs4Hxe7k43p4YJqqyRnhoXboBB7MCzN8QpqW9NXuSrF8
```

### Get Deployment by ID

```http
GET /api/deployments/:id
```

## API Documentation

Once running, access interactive API documentation at:
- Swagger UI: http://localhost:3001/api/docs

## Architecture

### Modules

- **DeploymentModule**: Handles deployment logic and API endpoints
- **WalletModule**: Manages Solana wallet operations
- **AppModule**: Root module with configuration

### Services

- **DeploymentService**: Orchestrates the deployment process
- **WalletService**: Generates and manages Solana keypairs

## Deployment Flow

1. **Request Creation**
   - Validates devnet program ID
   - Generates deployer keypair
   - Creates database record

2. **Program Dumping**
   - Executes `solana program dump` command
   - Saves .so file to temp directory

3. **Wallet Funding**
   - Admin wallet transfers deployment cost to deployer

4. **Mainnet Deployment**
   - Executes `solana program deploy` command
   - Captures program ID and transaction signature

5. **Status Updates**
   - Updates deployment status in database
   - Provides real-time status to frontend

## Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## Development

### Adding New Features

1. Create module: `nest g module feature`
2. Create service: `nest g service feature`
3. Create controller: `nest g controller feature`

## Troubleshooting

### Solana CLI Not Found

Ensure Solana CLI is installed and `SOLANA_CLI_PATH` is correctly set:

```bash
which solana
```

### Deployment Failures

Check logs for detailed error messages:

```bash
npm run start:dev
```

## Production Considerations

- Use environment-specific configuration files
- Implement proper logging (Winston, Pino)
- Add rate limiting middleware
- Encrypt sensitive data in database
- Use process managers (PM2, systemd)
- Set up monitoring (DataDog, New Relic)
- Implement proper error handling
- Add request validation
- Use connection pooling for Supabase

## License

MIT


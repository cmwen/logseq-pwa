# API Documentation

## Core Package API

### CoreService

The main service class providing core functionality.

```typescript
import { CoreService } from '@template/core';

const config = {
  name: 'My App',
  version: '1.0.0',
  environment: 'production'
};

const service = new CoreService(config);
```

#### Methods

##### `getConfig(): AppConfig`

Returns the current application configuration.

```typescript
const config = service.getConfig();
console.log(config.name); // 'My App'
```

##### `greet(name: string): string`

Generates a greeting message.

```typescript
const message = service.greet('Alice');
// Returns: "Hello, Alice! Welcome to My App."
```

### Utility Functions

#### `formatDate(date: Date): string`

Formats a date as an ISO string.

```typescript
import { formatDate } from '@template/core';

const formatted = formatDate(new Date());
// Returns: "2024-01-01T00:00:00.000Z"
```

#### `capitalize(str: string): string`

Capitalizes the first letter of a string.

```typescript
import { capitalize } from '@template/core';

const result = capitalize('hello');
// Returns: "Hello"
```

#### `delay(ms: number): Promise<void>`

Returns a promise that resolves after the specified milliseconds.

```typescript
import { delay } from '@template/core';

await delay(1000); // Wait 1 second
```

## Web Package API

### REST API Endpoints

#### Health Check

```
GET /api/health
```

Returns the health status of the server.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### Get Configuration

```
GET /api/config
```

Returns the application configuration.

**Response:**
```json
{
  "name": "Template Web",
  "version": "0.1.0",
  "environment": "development"
}
```

#### Greet User

```
POST /api/greet
```

Generates a greeting message for the provided name.

**Request Body:**
```json
{
  "name": "Alice"
}
```

**Response:**
```json
{
  "message": "Hello, Alice! Welcome to Template Web."
}
```

**Error Response (400):**
```json
{
  "error": "Name is required"
}
```

### Starting the Server

```typescript
import app from '@template/web';

const port = 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
```

## MCP Package API

### Tools

The MCP server exposes the following tools for AI agents:

#### greet

Greets a user by name.

**Input Schema:**
```json
{
  "name": "string (required)"
}
```

**Example:**
```json
{
  "name": "greet",
  "arguments": {
    "name": "Alice"
  }
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Hello, Alice! Welcome to Template MCP."
    }
  ]
}
```

#### get_config

Returns the application configuration.

**Input Schema:**
```json
{}
```

**Example:**
```json
{
  "name": "get_config",
  "arguments": {}
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"name\":\"Template MCP\",\"version\":\"0.1.0\",\"environment\":\"development\"}"
    }
  ]
}
```

### Starting the MCP Server

```bash
node packages/mcp/dist/server.js
```

The server runs on stdio for communication with AI clients.

## CLI Package API

### Commands

#### greet

Greets a user by name.

```bash
template-cli greet <name>
```

**Example:**
```bash
template-cli greet Alice
# Output: Hello, Alice! Welcome to Template CLI.
```

#### info

Displays application information.

```bash
template-cli info
```

**Example:**
```bash
template-cli info
# Output:
# Application Info:
#   Name: Template CLI
#   Version: 0.1.0
#   Environment: development
```

## Type Definitions

### AppConfig

```typescript
interface AppConfig {
  name: string;
  version: string;
  environment: 'development' | 'production' | 'test';
}
```

## Error Handling

All packages use standard error handling patterns:

- Validation errors throw with descriptive messages
- API endpoints return appropriate HTTP status codes
- MCP tools return error responses with `isError: true`
- CLI commands exit with non-zero codes on error

## Usage in Your Application

### Using Core Package

```typescript
import { CoreService, capitalize } from '@template/core';

// Initialize service
const service = new CoreService({
  name: 'My App',
  version: '1.0.0',
  environment: 'production'
});

// Use utility functions
const formatted = capitalize('hello world');
```

### Extending the Web Server

```typescript
import app from '@template/web';

// Add custom routes
app.get('/api/custom', (req, res) => {
  res.json({ message: 'Custom endpoint' });
});

// Add middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

app.listen(3000);
```

### Adding MCP Tools

```typescript
// In packages/mcp/src/server.ts

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'my_custom_tool') {
    // Handle custom tool
    return {
      content: [{ type: 'text', text: 'Result' }]
    };
  }
  
  // ... existing tools
});
```

### Adding CLI Commands

```typescript
// In packages/cli/src/index.ts

program
  .command('custom')
  .description('Custom command')
  .action(() => {
    console.log('Custom action');
  });
```

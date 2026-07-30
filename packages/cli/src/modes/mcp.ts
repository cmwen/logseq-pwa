import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CoreService } from '@template/core';
import { z } from 'zod';

export async function startMcpMode() {
  const config = {
    name: 'Template CLI - MCP Mode',
    version: '0.1.0',
    environment: 'development' as const,
  };

  const coreService = new CoreService(config);

  const server = new Server(
    {
      name: 'template-cli-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Tool schemas
  const GreetArgsSchema = z.object({
    name: z.string().describe('Name to greet'),
  });

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'greet',
          description: 'Greet a user by name',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Name to greet',
              },
            },
            required: ['name'],
          },
        },
        {
          name: 'get_config',
          description: 'Get application configuration',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === 'greet') {
        const { name: userName } = GreetArgsSchema.parse(args);
        const message = coreService.greet(userName);
        return {
          content: [
            {
              type: 'text',
              text: message,
            },
          ],
        };
      }

      if (name === 'get_config') {
        const cfg = coreService.getConfig();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(cfg, null, 2),
            },
          ],
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Template CLI - MCP server running on stdio');
}

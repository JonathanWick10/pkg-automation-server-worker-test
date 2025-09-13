import { AgentJobSource } from 'automation-server-shared-test'
import { Agent, agentbuiltInToolsNames, AgentOutputFieldType, AgentOutputType, isNil, McpWithTools } from 'automation-shared-test'
import { experimental_createMCPClient, tool } from 'ai'
import { z, ZodRawShape, ZodSchema } from 'zod'

export const agentTools = async <T extends AgentJobSource>(params: AgentToolsParams<T>) => {
  const mcpClient = await getMcpClient(params)
  const builtInTools = await buildInternalTools(params)
  const mcpTools = isNil(await mcpClient?.tools()) ? {} : await mcpClient!.tools()

  // Si aún ves inferencia pesada aquí, castea:
  // const tools: Record<string, unknown> = { ...builtInTools, ...mcpTools as Record<string, unknown> }
  const tools = {
    ...builtInTools,
    ...mcpTools,
  }

  return {
    tools: async () => tools,
    close: async () => { await mcpClient?.close() },
  }
}

async function buildInternalTools<T extends AgentJobSource>(params: AgentToolsParams<T>) {
  const isStructured = params.agent.outputType === AgentOutputType.STRUCTURED_OUTPUT

  // ⚠️ clave: un solo tipo concreto (no union) y sin await dentro del shape
  const inputSchema: z.AnyZodObject = isStructured
    ? z.object({
        // romper inferencia profunda del nested schema:
        output: getStructuredOutput(params.agent) as z.ZodTypeAny,
      })
    : z.object({})

  return {
    [agentbuiltInToolsNames.markAsComplete]: tool({
      description: 'Mark the todo as complete',
      // si tu SDK es reciente, usa "parameters" en vez de "inputSchema"
      inputSchema: inputSchema as z.ZodTypeAny,
      async execute() {
        return 'Marked as Complete'
      },
    } as any), // último “corta-fuego” contra inferencias profundas
  }
}

async function getMcpClient<T extends AgentJobSource>(params: AgentToolsParams<T>) {
    const mcpServer = params.mcp
    if (mcpServer.tools.length === 0) {
        return null
    }
    const mcpServerUrl = `${params.publicUrl}v1/mcp/${params.mcp.token}/sse`
    return experimental_createMCPClient({
        transport: {
            type: 'sse',
            url: mcpServerUrl,
        },
    })
}


function getStructuredOutput(agent: Agent): z.AnyZodObject {
  const outputFields = agent.outputFields ?? []
  const shape: ZodRawShape = {}

  for (const field of outputFields) {
    switch (field.type) {
      case AgentOutputFieldType.TEXT:
        shape[field.displayName] = z.string()
        break
      case AgentOutputFieldType.NUMBER:
        shape[field.displayName] = z.number()
        break
      case AgentOutputFieldType.BOOLEAN:
        shape[field.displayName] = z.boolean()
        break
      default:
        shape[field.displayName] = z.any()
    }
  }
  return z.object(shape)
}

type AgentToolsParams<T extends AgentJobSource> = {
    publicUrl: string
    token: string
    mcp: McpWithTools
    agent: Agent
    source: T
}

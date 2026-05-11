export interface Actor {
  id: string | number;
  first_name?: string;
  username?: string;
}

export function resolveActor(override?: Partial<Actor>): Actor {
  const id = override?.id ?? process.env.HOLONS_ACTOR_ID ?? 'mcp-ui';
  return {
    id,
    first_name: override?.first_name ?? process.env.HOLONS_ACTOR_NAME ?? 'MCP-UI',
    username: override?.username ?? process.env.HOLONS_ACTOR_USERNAME,
  };
}

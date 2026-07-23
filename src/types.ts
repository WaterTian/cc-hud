export interface StdinData {
  model?: { id?: string; display_name?: string };
  context_window?: {
    context_window_size?: number;
    used_percentage?: number | null;
    remaining_percentage?: number | null;
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null;
  };
  rate_limits?: {
    five_hour?: { used_percentage?: number | null; resets_at?: number | null } | null;
    seven_day?: { used_percentage?: number | null; resets_at?: number | null } | null;
  } | null;
  transcript_path?: string;
  cwd?: string;
}

export interface AgentEntry {
  id: string;
  type: string;
  model?: string;
  description?: string;
  status: 'running' | 'completed';
}

// Top-tier-model weekly gauge (the "Current week (Opus/Fable)" meter in /usage)
export interface TopModelUsage {
  name: string;
  percent: number;
  resetsAt: number | null;
}

export interface RenderData {
  model: string;
  modelVariant: string | null;
  contextPercent: number | null;
  agents: AgentEntry[];
  fiveHourPercent: number | null;
  sevenDayPercent: number | null;
  fiveHourResetsAt: number | null;
  sevenDayResetsAt: number | null;
  planTier: string | null;
  topModel: TopModelUsage | null;
  extra: string | null;
}

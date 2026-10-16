// stdin shape — see https://code.claude.com/docs/en/statusline ("Available data").
// Only the fields cc-hud reads are typed; everything else passes through untouched.
export interface RateWindow {
  used_percentage?: number | null;
  resets_at?: number | null; // Unix epoch seconds
}

// Gateway spend cap (rate_limits.spend_limit). used_usd / limit_usd / period
// stay absent under CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC.
export interface SpendLimitWindow extends RateWindow {
  used_usd?: number | null;
  limit_usd?: number | null;
  period?: 'daily' | 'weekly' | 'monthly' | string | null;
}

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
  // Absent for API-key sessions; each window can be independently absent
  // and is dropped once its resets_at passes. Unknown windows may appear.
  rate_limits?: ({
    five_hour?: RateWindow | null;
    seven_day?: RateWindow | null;
    spend_limit?: SpendLimitWindow | null;
  } & Record<string, RateWindow | SpendLimitWindow | null | undefined>) | null;
  effort?: { level?: string | null } | null; // absent when the model has no effort control
  cost?: {
    total_cost_usd?: number | null;
    total_duration_ms?: number;
    total_api_duration_ms?: number;
    total_lines_added?: number;
    total_lines_removed?: number;
  } | null;
  transcript_path?: string;
  cwd?: string;
  session_id?: string;
  session_name?: string;        // absent unless --name / /rename / AI title
  version?: string;             // Claude Code version
  exceeds_200k_tokens?: boolean; // top-level, fixed 200k threshold
  fast_mode?: boolean;
  thinking?: { enabled?: boolean };
  output_style?: { name?: string };
  vim?: { mode?: string };      // absent unless vim mode is on
  agent?: { name?: string };    // absent unless --agent / agent settings
  workspace?: {
    current_dir?: string;
    project_dir?: string;
    added_dirs?: string[];
    git_worktree?: string;      // absent unless in a linked worktree
    repo?: { host?: string; owner?: string; name?: string }; // absent without an origin remote
  };
  worktree?: {                  // absent unless in a worktree session
    name?: string;
    path?: string;
    branch?: string | null;
    original_cwd?: string;
    original_branch?: string | null;
  };
  pr?: {                        // absent when the branch has no open PR / MR
    number?: number;
    url?: string;
    review_state?: 'approved' | 'pending' | 'changes_requested' | 'draft' | string;
    kind?: 'mr' | string;
  };
  prompt_cache?: {              // absent until the first main-conversation response
    warm?: boolean;
    caching_observed?: boolean;
    ttl?: '5m' | '1h' | string;
    expires_at?: number | null;
    hit_ratio?: number | null;
    [k: string]: unknown;
  };
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

// Working directory + git branch (`cc-hud · main*`)
export interface WorkspaceInfo {
  name: string;
  branch: string | null;
  dirty: boolean;
}

// A rate window cc-hud has no dedicated slot for (future stdin additions)
export interface ExtraLimit {
  label: string;
  percent: number;
  resetsAt: number | null;
}

export interface SpendLimit {
  percent: number;
  resetsAt: number | null;
  usedUsd: number | null;
  limitUsd: number | null;
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
  spendLimit: SpendLimit | null;
  extraLimits: ExtraLimit[];
  thinkingDepth: string | null;
  topModel: TopModelUsage | null;
  topModelStale: boolean; // gauge last refreshed > 30 min ago — rendered with a ~ prefix
  workspace: WorkspaceInfo | null;
  costUsd: number | null;
  extra: string | null;
}

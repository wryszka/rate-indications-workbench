// Typed fetch wrapper for the Rate Indications API (base '/api').

export type AssumptionMeta = { name: string; label: string; unit: string; group: string };
export type Product = { code: string; label: string; tail: string };
export type Territory = { code: string; label: string; region: string };
export type ApprovalRole = { min: number; max: number; role: string; note: string };

export type Meta = {
  entity_name: string; book_flavour: string; currency: string; calc_version: string;
  experience_version: string; ai_mode: string; current_user: string; genie_enabled: boolean;
  products: Product[]; territories: Territory[]; periods: number[];
  assumptions: AssumptionMeta[]; approval_roles: ApprovalRole[];
};
export type GenieAnswer = {
  enabled: boolean; conversation_id?: string; answer: string;
  sql?: string | null; columns?: string[] | null; rows?: any[][] | null; status?: string;
};

export type PremiumSummary = {
  method: string; total_earned_premium: number; total_on_level_earned_premium: number;
  overall_on_level_factor: number; raw_reported_loss_ratio: number; on_level_reported_loss_ratio: number;
  reference_index?: number; currency?: string;
};
export type Result = {
  indicated_rate_change: number; projected_loss_ratio: number; permissible_loss_ratio: number;
  experience_loss_ratio: number; required_premium: number; on_level_earned_premium: number;
  projected_ultimate_loss: number; current_rate_level?: number;
  selected_rate_change?: number; calc_version?: string; experience_version?: string;
  calculated_by?: string; calculation_timestamp?: string;
  detail_years?: DetailYear[]; decomposition?: Step[];
  // on-level premium (Phase 1A)
  total_earned_premium?: number; raw_reported_loss_ratio?: number;
  on_level_reported_loss_ratio?: number; overall_on_level_factor?: number; on_level_method?: string;
  premium_summary?: PremiumSummary | null; input_hash?: string | null;
};
export type DetailYear = {
  accident_year: number; earned_premium: number; on_level_earned_premium: number;
  reported_incurred: number; effective_ldf: number; ultimate_loss: number;
  trend_years: number; trend_factor: number; trended_ultimate: number; loss_ratio: number;
  // on-level premium detail
  on_level_factor?: number; average_earned_index?: number; reference_index?: number;
  raw_reported_lr?: number | null; on_level_reported_lr?: number | null;
};
export type Step = { assumption: string; label: string; from: number | null; to: number | null; group?: string; contribution_pts: number };

// on-level premium settings + segment rate context
export type RateEventRow = {
  effective_date: string | null; rate_change_pct: number; rate_level_index?: number;
  event_id: string | null; status: string; date_source: string;
};
export type PremiumSettings = {
  method: string; reference_rate_date: string; baseline_effective_date: string;
  baseline_rate_index: number; policy_term_days: number; rate_history_version?: string | null;
  event_overrides: { effective_date: string; change: number; event_id?: string }[];
};
export type RateContext = {
  current_rate_level: number; baseline_effective_date: string; baseline_rate_index: number;
  reference_rate_date: string; policy_term_days: number; on_level_method: string;
  methods: string[]; events: RateEventRow[]; default_settings: PremiumSettings;
};

export type Segment = {
  lob_code: string; lob_label: string; territory_code: string; territory_label: string;
  baseline_indicated: number; projected_loss_ratio: number; on_level_earned_premium: number;
  selected_rate_change: number | null; baseline_scenario_id: string;
};
export type Portfolio = {
  period: number; currency: string; total_premium: number; portfolio_indicated: number; segments: Segment[];
};

export type Scenario = {
  scenario_id: string; scenario_name: string; status: string; is_baseline: boolean;
  indicated_rate_change: number | null; selected_rate_change: number | null;
  indication_period: number; lob_code: string; territory_code: string;
  updated_at?: string; owner?: string; selection_comment?: string;
};
export type ScenarioDetail = {
  scenario: any; assumptions: Record<string, number>; baseline: Record<string, number>;
  result: Result | null; premium_settings?: PremiumSettings;
  assumption_order: string[]; assumption_meta: Record<string, AssumptionMeta>;
};
export type SegmentView = { baseline: ScenarioDetail; scenarios: Scenario[]; rate_context: RateContext };
export type Preview = {
  result: Result; baseline_indicated: number; decomposition: Step[]; recorded: boolean;
  premium_summary?: PremiumSummary; premium_settings?: PremiumSettings;
};
export type AuditEvent = {
  log_ts: string; action: string; actor: string; from_status: string | null;
  to_status: string | null; calc_version: string; result_id: string | null; note: string | null;
};
export type LearnCard = { n: number; group: string; activity: string; how: string; links: { label: string; kind: string }[] };

export class ApiError extends Error {
  status: number; body: any;
  constructor(message: string, status: number, body: any) { super(message); this.status = status; this.body = body; }
}
async function parseErr(r: Response): Promise<never> {
  let b: any = {};
  try { b = await r.json(); } catch { /* non-json */ }
  throw new ApiError(b.error || r.statusText, r.status, b);
}
async function get<T>(url: string): Promise<T> {
  const r = await fetch('/api' + url);
  if (!r.ok) return parseErr(r);
  return r.json();
}
async function send<T>(method: string, url: string, body?: any, signal?: AbortSignal): Promise<T> {
  const r = await fetch('/api' + url, {
    method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal,
  });
  if (!r.ok) return parseErr(r);
  return r.json();
}

export const api = {
  meta: () => get<Meta>('/meta'),
  portfolio: (period: number) => get<Portfolio>(`/portfolio?period=${period}`),
  segment: (lob: string, territory: string, period: number) =>
    get<SegmentView>(`/segment?lob=${lob}&territory=${territory}&period=${period}`),
  preview: (lob: string, territory: string, period: number, assumptions: Record<string, number>,
            premium_settings?: PremiumSettings, signal?: AbortSignal) =>
    send<Preview>('POST', '/preview', { lob, territory, period, assumptions, premium_settings }, signal),
  scenarios: (lob?: string, territory?: string, period?: number) => {
    const q = new URLSearchParams();
    if (lob) q.set('lob', lob); if (territory) q.set('territory', territory);
    if (period) q.set('period', String(period));
    return get<{ scenarios: Scenario[] }>(`/scenarios?${q}`);
  },
  createScenario: (b: { name: string; lob: string; territory: string; period: number; cloned_from?: string }) =>
    send<{ scenario_id: string }>('POST', '/scenarios', b),
  scenario: (id: string) => get<ScenarioDetail>(`/scenarios/${id}`),
  saveAssumptions: (id: string, assumptions: Record<string, number>) =>
    send<{ saved: boolean }>('PUT', `/scenarios/${id}/assumptions`, { assumptions }),
  savePremiumSettings: (id: string, premium_settings: PremiumSettings) =>
    send<{ saved: boolean }>('PUT', `/scenarios/${id}/premium-settings`, { premium_settings }),
  exportUrl: (id: string) => `/api/scenarios/${id}/export`,
  calculate: (id: string) => send<Preview & { result_id: string }>('POST', `/scenarios/${id}/calculate`),
  selectRate: (id: string, selected_rate_change: number, comment: string) =>
    send('POST', `/scenarios/${id}/select-rate`, { selected_rate_change, comment }),
  submit: (id: string) => send('POST', `/scenarios/${id}/submit`),
  review: (id: string, decision: 'approve' | 'reject', note: string, approver_role?: string) =>
    send<{ status: string }>('POST', `/scenarios/${id}/review`, { decision, note, approver_role }),
  aiMode: () => get<{ mode: string }>('/ai-mode'),
  setAiMode: (mode: string) => send<{ mode: string }>('POST', '/ai-mode', { mode }),
  reset: () => send<{ reset: boolean; removed_scenarios: number }>('POST', '/admin/reset', {}),
  genieAsk: (question: string, conversation_id?: string) =>
    send<GenieAnswer>('POST', '/genie/ask', { question, conversation_id }),
  compare: (ids: string[]) => get<{ scenarios: ScenarioDetail[]; assumption_order: string[]; assumption_meta: Record<string, AssumptionMeta> }>(`/compare?ids=${ids.join(',')}`),
  audit: (scenario_id: string) => get<{ events: AuditEvent[] }>(`/audit?scenario_id=${scenario_id}`),
  explain: (body: any) => send<{ ok: boolean; answer: string; source: string }>('POST', '/explain', body),
  learn: () => get<{ cards: LearnCard[] }>('/learn'),
};

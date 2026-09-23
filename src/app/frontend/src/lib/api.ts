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

export type Result = {
  indicated_rate_change: number; projected_loss_ratio: number; permissible_loss_ratio: number;
  experience_loss_ratio: number; required_premium: number; on_level_earned_premium: number;
  projected_ultimate_loss: number; current_rate_level?: number;
  selected_rate_change?: number; calc_version?: string; experience_version?: string;
  calculated_by?: string; calculation_timestamp?: string;
  detail_years?: DetailYear[]; decomposition?: Step[];
};
export type DetailYear = {
  accident_year: number; earned_premium: number; on_level_earned_premium: number;
  reported_incurred: number; effective_ldf: number; ultimate_loss: number;
  trend_years: number; trend_factor: number; trended_ultimate: number; loss_ratio: number;
};
export type Step = { assumption: string; label: string; from: number; to: number; contribution_pts: number };

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
  result: Result | null; assumption_order: string[]; assumption_meta: Record<string, AssumptionMeta>;
};
export type SegmentView = { baseline: ScenarioDetail; scenarios: Scenario[] };
export type Preview = { result: Result; baseline_indicated: number; decomposition: Step[]; recorded: boolean };
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
async function send<T>(method: string, url: string, body?: any): Promise<T> {
  const r = await fetch('/api' + url, {
    method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) return parseErr(r);
  return r.json();
}

export const api = {
  meta: () => get<Meta>('/meta'),
  portfolio: (period: number) => get<Portfolio>(`/portfolio?period=${period}`),
  segment: (lob: string, territory: string, period: number) =>
    get<SegmentView>(`/segment?lob=${lob}&territory=${territory}&period=${period}`),
  preview: (lob: string, territory: string, period: number, assumptions: Record<string, number>) =>
    send<Preview>('POST', '/preview', { lob, territory, period, assumptions }),
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

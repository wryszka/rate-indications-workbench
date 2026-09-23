"""
Rate Indications assistant — a Mosaic AI Agent-Framework ResponsesAgent (MLflow 3).

Advise-only: it answers questions by calling **governed Unity Catalog functions**
(the deterministic calc primitive + read tools over the recorded results and the
governance evidence) — it never computes an indication itself. This is the
platform-native replacement for the app-hosted Foundation-Model calls: the tool
surface is UC functions, the agent is served on Model Serving via the UC AI
Gateway, and the app becomes a thin client that calls the endpoint.
"""
import mlflow
from mlflow.pyfunc import ResponsesAgent
from mlflow.types.responses import (
    ResponsesAgentRequest, ResponsesAgentResponse, ResponsesAgentStreamEvent,
    output_to_responses_items_stream, to_chat_completions_input,
)
from databricks_langchain import ChatDatabricks, UCFunctionToolkit
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt.tool_node import ToolNode
from typing import Annotated, Generator, Sequence, TypedDict

LLM_ENDPOINT = "databricks-claude-sonnet-4-6"
_SCHEMA = "lr_dev_aws_us_catalog.rate_indications"
UC_FUNCTIONS = [
    f"{_SCHEMA}.fn_permissible_loss_ratio",
    f"{_SCHEMA}.fn_segment_indication",
    f"{_SCHEMA}.fn_governance_evidence",
]
SYSTEM_PROMPT = (
    "You are the Bricksurance Rate Indications assistant — advise-only. You EXPLAIN, "
    "REVIEW and REPORT on P&C rate indications for a pricing actuary; you NEVER compute "
    "or file a rate yourself. Use the tools for facts: fn_segment_indication for the "
    "recorded indication + premium basis of a product/territory/period; "
    "fn_permissible_loss_ratio for the break-even loss ratio from the provisions; "
    "fn_governance_evidence for oversight questions (audit completeness, blocked "
    "approvals, reproducibility). Quote the figures the tools return; do not invent "
    "numbers. Rates shown are decimals (0.066 = +6.6%). All data is synthetic "
    "(fictional insurer Bricksurance SE). Be concise and plain-spoken.\n\n"
    "SEGMENT CODES — the tools filter on exact codes, so translate the user's wording "
    "to these before calling a tool and pass them verbatim:\n"
    "- line of business (p_lob): GENERAL_LIABILITY, COMMERCIAL_MOTOR, COMMERCIAL_PROPERTY\n"
    "- territory (p_territory): ISO-2 country codes DE (Germany), FR (France), "
    "IT (Italy), ES (Spain), NL (Netherlands)\n"
    "- period (p_period): a 4-digit year, e.g. 2027 (the current indication year)\n"
    "Example: 'General Liability in Germany for 2027' -> p_lob=GENERAL_LIABILITY, "
    "p_territory=DE, p_period=2027. If a tool returns no rows, re-check you used these "
    "exact codes before telling the user there is no data."
)


class State(TypedDict):
    messages: Annotated[Sequence, add_messages]


class RateIndicationsAgent(ResponsesAgent):
    def __init__(self):
        self.llm = ChatDatabricks(endpoint=LLM_ENDPOINT)
        self.tools = list(UCFunctionToolkit(function_names=UC_FUNCTIONS).tools)
        self.llm_with_tools = self.llm.bind_tools(self.tools)

    def _graph(self):
        def call_model(state):
            msgs = [{"role": "system", "content": SYSTEM_PROMPT}] + state["messages"]
            return {"messages": [self.llm_with_tools.invoke(msgs)]}

        def should_continue(state):
            last = state["messages"][-1]
            return "tools" if isinstance(last, AIMessage) and last.tool_calls else "end"

        g = StateGraph(State)
        g.add_node("agent", RunnableLambda(call_model))
        g.add_node("tools", ToolNode(self.tools))
        g.set_entry_point("agent")
        g.add_conditional_edges("agent", should_continue, {"tools": "tools", "end": END})
        g.add_edge("tools", "agent")
        return g.compile()

    def predict_stream(self, req: ResponsesAgentRequest) -> Generator[ResponsesAgentStreamEvent, None, None]:
        msgs = to_chat_completions_input([m.model_dump() for m in req.input])
        for kind, payload in self._graph().stream({"messages": msgs}, stream_mode=["updates"]):
            if kind != "updates":
                continue
            for node in payload.values():
                if node.get("messages"):
                    yield from output_to_responses_items_stream(node["messages"])

    def predict(self, req: ResponsesAgentRequest) -> ResponsesAgentResponse:
        items = [ev.item for ev in self.predict_stream(req) if ev.type == "response.output_item.done"]
        return ResponsesAgentResponse(output=items)


mlflow.langchain.autolog()
mlflow.models.set_model(RateIndicationsAgent())

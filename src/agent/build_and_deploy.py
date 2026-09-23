# Databricks notebook source
# MAGIC %md
# MAGIC # Build + deploy the Rate Indications ResponsesAgent
# MAGIC Logs `agent.py` to Unity Catalog with passthrough-auth `resources` (the Claude
# MAGIC serving endpoint + the three governed UC functions), validates it, registers `@prod`,
# MAGIC and deploys it to a Model Serving endpoint (Agent Framework / UC AI Gateway).
# MAGIC Submitted as a serverless job — `agents.deploy()` blocks ~15 min.

# COMMAND ----------
import json, os
import mlflow
from mlflow.models.resources import DatabricksServingEndpoint, DatabricksFunction
from mlflow.tracking import MlflowClient

ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
nb = ctx.notebookPath().get()
nb_dir = nb.rsplit("/", 1)[0]
agent_file = "/Workspace" + nb_dir + "/agent.py"     # co-located agent.py (Models-from-code)

from sys import path as _p
_p.insert(0, "/Workspace" + nb_dir)
from agent import LLM_ENDPOINT, UC_FUNCTIONS  # noqa

CATALOG, SCHEMA = "lr_dev_aws_us_catalog", "rate_indications"
FULL_NAME = f"{CATALOG}.{SCHEMA}.rate_indications_agent"
ENDPOINT = "rate-indications-agent"

mlflow.set_registry_uri("databricks-uc")
exp_dir = "/Workspace/Users/laurence.ryszka@databricks.com/rate_indications_agent"
try:
    from databricks.sdk import WorkspaceClient
    WorkspaceClient().workspace.mkdirs(exp_dir)   # experiment parent must exist
except Exception as e:
    print("mkdirs:", e)
mlflow.set_experiment(exp_dir + "/experiment")

resources = [DatabricksServingEndpoint(endpoint_name=LLM_ENDPOINT),
             *[DatabricksFunction(function_name=f) for f in UC_FUNCTIONS]]

with mlflow.start_run(run_name="log"):
    info = mlflow.pyfunc.log_model(
        name="agent",
        python_model=agent_file,
        resources=resources,
        input_example={"input": [{"role": "user", "content": "What's the baseline indication for General Liability in Germany 2027?"}]},
        pip_requirements=["mlflow", "databricks-langchain", "langgraph", "databricks-agents", "pydantic>=2"],
        registered_model_name=FULL_NAME,
    )
print("logged:", info.model_uri)

# pre-deploy validation (rebuild env, run a request) — surfaces failures before the endpoint does
mlflow.models.predict(model_uri=info.model_uri,
                      input_data={"input": [{"role": "user", "content": "ping"}]},
                      env_manager="uv")

client = MlflowClient(registry_uri="databricks-uc")
v = max(client.search_model_versions(f"name='{FULL_NAME}'"), key=lambda x: int(x.version)).version
client.set_registered_model_alias(FULL_NAME, "prod", v)
print("registered version", v)

# COMMAND ----------
from databricks import agents
deployment = agents.deploy(FULL_NAME, v, endpoint_name=ENDPOINT,
                           tags={"ai_generated_source": "databricks-agent-skills"})
dbutils.notebook.exit(json.dumps({"endpoint_name": deployment.endpoint_name,
                                  "query_endpoint": getattr(deployment, "query_endpoint", None),
                                  "model_version": v}))

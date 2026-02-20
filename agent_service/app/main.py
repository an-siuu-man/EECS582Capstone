from fastapi import FastAPI, HTTPException
from dotenv import load_dotenv
from .schemas import RunAgentRequest
from .agent import run_headstart_agent
import traceback

load_dotenv()

app = FastAPI(title="Headstart Agent Service")

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/run-agent")
def run_agent(req: RunAgentRequest):
    print("✅ /run-agent reached")  # <--- MUST PRINT
    try:
        result = run_headstart_agent(req.payload, req.pdf_text or "")
        print("✅ agent returned")  # <--- MUST PRINT if agent succeeds
        return result
    except Exception as e:
        print("❌ agent error:", repr(e))  # <--- MUST PRINT
        traceback.print_exc()             # <--- MUST PRINT STACK TRACE
        raise HTTPException(status_code=500, detail=str(e))
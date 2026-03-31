# Headstart AI

Headstart AI is built for a very common student problem.

You open a Canvas assignment, there is a lot of text, maybe a rubric, maybe a PDF or two, and you need to quickly figure out what matters and how to plan your work. Headstart helps you move from "what am I even looking at?" to "here is my plan."

## What using Headstart feels like

You start on Canvas like usual.  
Headstart picks up the assignment context from the page.  
You trigger guide generation.  
Then you move into the dashboard where the guide streams in, and you can keep chatting with assignment-aware context.

Later, you can come back to the same session, continue the conversation, and organize your study time from the calendar view.

## The three parts (and why they matter to you)

### The Chrome Extension
This is your entry point inside Canvas. It detects assignment pages, captures assignment details, and gives you a direct way to start a guide without leaving your workflow.

### The Web Dashboard
This is where you spend most of your time after starting a guide. You can watch progress, read the final guide, ask follow-up questions, reopen past chats, and manage sessions. It is also where calendar planning happens.

### The Agent Service
This is the part that does the AI-heavy lifting in the background. It processes assignment context (including attachments) and turns it into a useful, structured guide that the dashboard can stream back to you.

## What you can do right now

- Generate assignment guides from Canvas pages.
- Ask follow-up questions in chat with assignment context preserved.
- Revisit previous chat sessions.
- Delete chat sessions you no longer want.
- Use the dashboard calendar tools to plan study blocks.

## Quick local setup

If you are running the project locally, here is the short version.

### 1) Start the agent service

```bash
cd agent_service
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2) Start the web app

```bash
cd webapp
npm install
npm run dev
```

The dashboard runs at `http://localhost:3000`.

### 3) Build and load the extension

```bash
cd extension
npm install
npm run build
```

Then load the unpacked extension in Chrome from the `extension/` folder.

## Project layout (simple view)

- `extension/` is the Canvas-side browser extension.
- `webapp/` is the dashboard and API layer.
- `agent_service/` is the AI orchestration service.
- `docs/` and `internal/architecture/` hold deeper design references.

## If you want deeper technical detail

For architecture-level docs:

- `extension/ARCHITECTURE.md`
- `webapp/ARCHITECTURE.md`
- `agent_service/ARCHITECTURE.md`
- `internal/architecture/*`


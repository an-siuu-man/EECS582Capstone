# Headstart Architecture - Poster Diagram

```mermaid
flowchart LR
  Student["Student"]
  Canvas["Canvas LMS<br/>assignment page"]
  Extension["Headstart Chrome Extension<br/>reads assignment details"]
  WebApp["Headstart Web App<br/>dashboard, chat, calendar"]
  Supabase["Supabase<br/>login, database, file storage"]
  Agent["AI Agent Service<br/>guide generation + chat"]
  NVIDIA["NVIDIA AI Models<br/>language, vision, embeddings"]
  Google["Google Calendar<br/>study scheduling"]

  Student -->|"opens assignment"| Canvas
  Canvas -->|"assignment text, rubric, PDFs"| Extension
  Extension -->|"send assignment"| WebApp

  Student -->|"views guide and chats"| WebApp
  WebApp <-->|"save users, assignments,<br/>guides, messages, files"| Supabase
  WebApp <-->|"stream guide and answers"| Agent
  Agent <-->|"generate, read PDFs/images,<br/>search assignment context"| NVIDIA
  Agent <-->|"store/search RAG chunks"| Supabase
  WebApp <-->|"events and study blocks"| Google
```

## What This Shows

Headstart starts inside Canvas, where the Chrome extension collects the assignment details a student is already viewing. The web app saves that assignment, shows the dashboard experience, and asks the AI agent service to generate a study guide or answer follow-up questions.

Supabase keeps the durable project data: accounts, assignments, uploaded files, guides, chat messages, and searchable RAG chunks. NVIDIA models power the AI responses, PDF/image understanding, and semantic search. Google Calendar is optional and is used for planning study sessions around assignment due dates.

## Main Idea

Headstart turns a Canvas assignment into an interactive study guide, then helps the student keep asking questions and schedule work time from one dashboard.
